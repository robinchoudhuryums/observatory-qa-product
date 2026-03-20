/**
 * Open Dental EHR Adapter
 *
 * Open Dental is an open-source dental practice management software with a
 * well-documented REST API (Open Dental API / FHIR). This adapter integrates
 * Observatory QA with Open Dental for:
 * - Patient record lookup (demographics, insurance, allergies, medications)
 * - Appointment data (for call context enrichment)
 * - Clinical note push (write AI-generated notes back to patient records)
 * - Treatment plan retrieval (for treatment acceptance call scoring)
 *
 * API Documentation: https://www.opendental.com/site/apiDocumentation.html
 * The API uses a developer key + customer key authentication model.
 *
 * Configuration (stored in org settings):
 *   baseUrl: "https://<practice-server>/api/v1" or Open Dental Cloud URL
 *   apiKey: Developer key
 *   options.customerKey: Customer-specific API key
 */

import type {
  IEhrAdapter,
  EhrConnectionConfig,
  EhrPatient,
  EhrAppointment,
  EhrClinicalNote,
  EhrTreatmentPlan,
  EhrSyncResult,
} from "./types.js";

export class OpenDentalAdapter implements IEhrAdapter {
  readonly system = "open_dental" as const;

  private buildHeaders(config: EhrConnectionConfig): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `ODFHIR ${config.apiKey}/${config.options?.customerKey || ""}`,
    };
  }

  private async request<T>(config: EhrConnectionConfig, method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    const headers = this.buildHeaders(config);

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Open Dental API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      // Open Dental API version/status endpoint
      const result = await this.request<{ Version?: string }>(config, "GET", "/patients?Limit=1");
      return { connected: true, version: result?.Version || "unknown" };
    } catch (err) {
      return {
        connected: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  async searchPatients(
    config: EhrConnectionConfig,
    query: { name?: string; dob?: string; phone?: string }
  ): Promise<EhrPatient[]> {
    const params = new URLSearchParams();
    if (query.name) params.set("LName", query.name.split(" ").pop() || query.name);
    if (query.dob) params.set("Birthdate", query.dob);
    if (query.phone) params.set("HmPhone", query.phone);
    params.set("Limit", "20");

    const patients = await this.request<OpenDentalPatient[]>(
      config, "GET", `/patients?${params.toString()}`
    );

    return patients.map(p => this.mapPatient(p));
  }

  async getPatient(config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null> {
    try {
      const patient = await this.request<OpenDentalPatient>(
        config, "GET", `/patients/${ehrPatientId}`
      );
      return this.mapPatient(patient);
    } catch {
      return null;
    }
  }

  async getAppointments(
    config: EhrConnectionConfig,
    params: { startDate: string; endDate: string; providerId?: string }
  ): Promise<EhrAppointment[]> {
    const queryParams = new URLSearchParams({
      date: params.startDate,
      dateEnd: params.endDate,
    });
    if (params.providerId) queryParams.set("provNum", params.providerId);

    const appointments = await this.request<OpenDentalAppointment[]>(
      config, "GET", `/appointments?${queryParams.toString()}`
    );

    return appointments.map(a => this.mapAppointment(a));
  }

  async getTodayAppointments(config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]> {
    const today = new Date().toISOString().split("T")[0]!;
    return this.getAppointments(config, { startDate: today, endDate: today, providerId });
  }

  async pushClinicalNote(config: EhrConnectionConfig, note: EhrClinicalNote): Promise<EhrSyncResult> {
    try {
      // Open Dental uses "commlog" (communication log) or "procnote" for clinical notes
      const result = await this.request<{ CommlogNum?: number; ProcNoteNum?: number }>(
        config, "POST", "/commlog", {
          PatNum: note.patientId,
          CommDateTime: note.date,
          CommType: 0, // General note
          Note: note.content,
          Mode_: 0, // None (documentation)
          UserNum: note.providerId,
        }
      );

      return {
        success: true,
        ehrRecordId: String(result?.CommlogNum || result?.ProcNoteNum || ""),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to push note",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getPatientTreatmentPlans(config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]> {
    try {
      const plans = await this.request<OpenDentalTreatPlan[]>(
        config, "GET", `/treatplans?PatNum=${patientId}`
      );

      return plans.map(plan => ({
        ehrPlanId: String(plan.TreatPlanNum),
        patientId,
        providerId: "",
        status: this.mapTreatPlanStatus(plan.TPStatus),
        phases: [], // Open Dental doesn't natively phase — procedures are flat
        totalFee: 0,
        totalInsurance: 0,
        totalPatient: 0,
        createdAt: plan.DateTP || new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  // --- Private mapping helpers ---

  private mapPatient(p: OpenDentalPatient): EhrPatient {
    return {
      ehrPatientId: String(p.PatNum),
      firstName: p.FName || "",
      lastName: p.LName || "",
      dateOfBirth: p.Birthdate || "",
      phone: p.HmPhone || p.WirelessPhone || undefined,
      email: p.Email || undefined,
      insurance: p.carrierName ? {
        carrier: p.carrierName,
        subscriberId: p.SubscriberID || undefined,
      } : undefined,
      allergies: p.MedicalComp ? [p.MedicalComp] : undefined,
      medicalAlerts: p.MedUrgNote ? [p.MedUrgNote] : undefined,
      lastVisitDate: p.DateLastVisit || undefined,
    };
  }

  private mapAppointment(a: OpenDentalAppointment): EhrAppointment {
    return {
      ehrAppointmentId: String(a.AptNum),
      patientId: String(a.PatNum),
      patientName: a.PatientName || "",
      providerId: String(a.ProvNum),
      providerName: a.ProviderName || "",
      date: a.AptDateTime?.split("T")[0] || "",
      startTime: a.AptDateTime?.split("T")[1]?.slice(0, 5) || "",
      duration: Math.round((a.Pattern?.length || 1) * 5), // Each char = 5 min in Open Dental
      status: this.mapAptStatus(a.AptStatus),
      notes: a.Note || undefined,
    };
  }

  private mapAptStatus(status: number | undefined): EhrAppointment["status"] {
    switch (status) {
      case 1: return "scheduled";
      case 2: return "completed";
      case 3: return "cancelled"; // Unscheduled list
      case 5: return "cancelled"; // Broken
      default: return "scheduled";
    }
  }

  private mapTreatPlanStatus(status: number | undefined): EhrTreatmentPlan["status"] {
    switch (status) {
      case 0: return "proposed"; // Active
      case 1: return "completed"; // Inactive
      default: return "proposed";
    }
  }
}

// --- Open Dental API types (subset of fields we use) ---

interface OpenDentalPatient {
  PatNum: number;
  FName: string;
  LName: string;
  Birthdate?: string;
  HmPhone?: string;
  WirelessPhone?: string;
  Email?: string;
  carrierName?: string;
  SubscriberID?: string;
  MedicalComp?: string;
  MedUrgNote?: string;
  DateLastVisit?: string;
}

interface OpenDentalAppointment {
  AptNum: number;
  PatNum: number;
  PatientName?: string;
  ProvNum: number;
  ProviderName?: string;
  AptDateTime?: string;
  Pattern?: string;
  AptStatus?: number;
  Note?: string;
  ProcDescript?: string;
}

interface OpenDentalTreatPlan {
  TreatPlanNum: number;
  PatNum: number;
  TPStatus?: number;
  Heading?: string;
  DateTP?: string;
  Note?: string;
}
