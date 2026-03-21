/**
 * Eaglesoft EHR Adapter
 *
 * Eaglesoft (Patterson Dental) is a widely-used dental practice management system.
 * Integration is through the eDex (Eaglesoft Data Exchange) API, which provides
 * read access to patient demographics, appointments, and insurance data.
 *
 * Note: Eaglesoft's API is more restrictive than Open Dental's.
 * - Read access is generally available through eDex
 * - Write access (clinical notes, treatment plans) requires Patterson's
 *   eClinicalWorks integration or direct database bridge — more complex
 * - Clinical note push may require Eaglesoft's "Smart Doc" integration
 *
 * Configuration (stored in org settings):
 *   baseUrl: "https://<practice-server>/eDex" or Eaglesoft Cloud URL
 *   apiKey: eDex API key (obtained from Patterson)
 *   options.practiceId: Practice identifier for multi-location setups
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
import { ehrRequest } from "./request.js";

export class EaglesoftAdapter implements IEhrAdapter {
  readonly system = "eaglesoft" as const;

  private buildHeaders(config: EhrConnectionConfig): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-API-Key": config.apiKey || "",
      ...(config.options?.practiceId ? { "X-Practice-ID": config.options.practiceId } : {}),
    };
  }

  private async request<T>(config: EhrConnectionConfig, method: string, path: string, body?: unknown): Promise<T> {
    const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
    return ehrRequest<T>({
      method, url, body,
      headers: this.buildHeaders(config),
      systemLabel: "Eaglesoft",
    });
  }

  async testConnection(config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      const result = await this.request<{ version?: string; status?: string }>(
        config, "GET", "/status"
      );
      return { connected: true, version: result?.version || "unknown" };
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
    if (query.name) params.set("search", query.name);
    if (query.dob) params.set("dob", query.dob);
    if (query.phone) params.set("phone", query.phone);
    params.set("limit", "20");

    const response = await this.request<{ patients: EaglesoftPatient[] }>(
      config, "GET", `/patients?${params.toString()}`
    );

    return (response.patients || []).map(p => this.mapPatient(p));
  }

  async getPatient(config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null> {
    try {
      const patient = await this.request<EaglesoftPatient>(
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
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.providerId) queryParams.set("providerId", params.providerId);

    const response = await this.request<{ appointments: EaglesoftAppointment[] }>(
      config, "GET", `/appointments?${queryParams.toString()}`
    );

    return (response.appointments || []).map(a => this.mapAppointment(a));
  }

  async getTodayAppointments(config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]> {
    const today = new Date().toISOString().split("T")[0]!;
    return this.getAppointments(config, { startDate: today, endDate: today, providerId });
  }

  async pushClinicalNote(config: EhrConnectionConfig, note: EhrClinicalNote): Promise<EhrSyncResult> {
    // Eaglesoft write access is limited — clinical notes typically require
    // Smart Doc integration or direct database bridge. For now, we attempt
    // the eDex notes endpoint, but this may not be available on all installations.
    try {
      const result = await this.request<{ noteId?: string }>(
        config, "POST", "/clinical-notes", {
          patientId: note.patientId,
          providerId: note.providerId,
          date: note.date,
          type: note.noteType,
          content: note.content,
        }
      );

      return {
        success: true,
        ehrRecordId: result?.noteId || "",
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to push note";

      // Eaglesoft may not support write operations — provide helpful guidance
      if (message.includes("405") || message.includes("403")) {
        return {
          success: false,
          error: "Clinical note push not available — Eaglesoft eDex may require Smart Doc integration for write access. Contact Patterson Dental for API write permissions.",
          timestamp: new Date().toISOString(),
        };
      }

      return {
        success: false,
        error: message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getPatientTreatmentPlans(config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]> {
    try {
      const response = await this.request<{ treatmentPlans: EaglesoftTreatmentPlan[] }>(
        config, "GET", `/patients/${patientId}/treatment-plans`
      );

      return (response.treatmentPlans || []).map(plan => ({
        ehrPlanId: plan.id,
        patientId,
        providerId: plan.providerId || "",
        status: this.mapPlanStatus(plan.status),
        phases: (plan.phases || []).map((phase, i) => ({
          phase: i + 1,
          description: phase.description || `Phase ${i + 1}`,
          procedures: (phase.procedures || []).map(p => ({
            code: p.code,
            description: p.description,
            toothNumber: p.toothNumber,
            surface: p.surface,
            fee: p.fee || 0,
            insuranceEstimate: p.insuranceEstimate || 0,
            patientEstimate: p.patientEstimate || 0,
          })),
        })),
        totalFee: plan.totalFee || 0,
        totalInsurance: plan.totalInsurance || 0,
        totalPatient: plan.totalPatient || 0,
        createdAt: plan.createdDate || new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  // --- Private mapping helpers ---

  private mapPatient(p: EaglesoftPatient): EhrPatient {
    return {
      ehrPatientId: p.id,
      firstName: p.firstName || "",
      lastName: p.lastName || "",
      dateOfBirth: p.dateOfBirth || "",
      phone: p.homePhone || p.cellPhone || undefined,
      email: p.email || undefined,
      insurance: p.primaryInsurance ? {
        carrier: p.primaryInsurance.carrierName || "",
        groupNumber: p.primaryInsurance.groupNumber || undefined,
        subscriberId: p.primaryInsurance.subscriberId || undefined,
        planType: p.primaryInsurance.planType || undefined,
      } : undefined,
      allergies: p.allergies || undefined,
      medications: p.medications || undefined,
      medicalAlerts: p.alerts ? [p.alerts] : undefined,
      lastVisitDate: p.lastVisitDate || undefined,
    };
  }

  private mapAppointment(a: EaglesoftAppointment): EhrAppointment {
    return {
      ehrAppointmentId: a.id,
      patientId: a.patientId,
      patientName: a.patientName || "",
      providerId: a.providerId || "",
      providerName: a.providerName || "",
      date: a.date || "",
      startTime: a.startTime || "",
      duration: a.duration || 30,
      status: this.mapAptStatus(a.status),
      procedures: a.procedures?.map(p => ({ code: p.code, description: p.description })),
      notes: a.notes || undefined,
    };
  }

  private mapAptStatus(status: string | undefined): EhrAppointment["status"] {
    switch (status?.toLowerCase()) {
      case "scheduled": return "scheduled";
      case "confirmed": return "confirmed";
      case "checked_in": case "seated": return "checked_in";
      case "in_progress": case "in_chair": return "in_progress";
      case "completed": case "complete": return "completed";
      case "cancelled": case "canceled": return "cancelled";
      case "no_show": case "noshow": return "no_show";
      default: return "scheduled";
    }
  }

  private mapPlanStatus(status: string | undefined): EhrTreatmentPlan["status"] {
    switch (status?.toLowerCase()) {
      case "proposed": case "pending": return "proposed";
      case "accepted": case "approved": return "accepted";
      case "in_progress": case "active": return "in_progress";
      case "completed": case "done": return "completed";
      case "declined": case "rejected": return "declined";
      default: return "proposed";
    }
  }
}

// --- Eaglesoft eDex API types (subset of fields we use) ---

interface EaglesoftPatient {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  homePhone?: string;
  cellPhone?: string;
  email?: string;
  primaryInsurance?: {
    carrierName?: string;
    groupNumber?: string;
    subscriberId?: string;
    planType?: string;
  };
  allergies?: string[];
  medications?: string[];
  alerts?: string;
  lastVisitDate?: string;
}

interface EaglesoftAppointment {
  id: string;
  patientId: string;
  patientName?: string;
  providerId?: string;
  providerName?: string;
  date?: string;
  startTime?: string;
  duration?: number;
  status?: string;
  procedures?: Array<{ code: string; description: string }>;
  notes?: string;
}

interface EaglesoftTreatmentPlan {
  id: string;
  patientId: string;
  providerId?: string;
  status?: string;
  phases?: Array<{
    description?: string;
    procedures?: Array<{
      code: string;
      description: string;
      toothNumber?: string;
      surface?: string;
      fee?: number;
      insuranceEstimate?: number;
      patientEstimate?: number;
    }>;
  }>;
  totalFee?: number;
  totalInsurance?: number;
  totalPatient?: number;
  createdDate?: string;
}
