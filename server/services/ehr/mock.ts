/**
 * Mock EHR Adapter — for development, testing, and demo mode.
 *
 * Returns realistic test data without making any real HTTP calls.
 * Enable via ehrConfig.system = "mock" in org settings.
 *
 * Usage:
 * - Development: work on EHR features without credentials
 * - E2E testing: test the full EHR flow without external dependencies
 * - Sales demos: show EHR integration with realistic sample data
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

const MOCK_PATIENTS: EhrPatient[] = [
  {
    ehrPatientId: "mock-1001",
    firstName: "Sarah",
    lastName: "Johnson",
    dateOfBirth: "1985-03-15",
    phone: "555-0101",
    email: "sarah.johnson@example.com",
    insurance: { carrier: "Delta Dental", groupNumber: "GRP-5678", subscriberId: "DD-12345", planType: "PPO" },
    allergies: ["Penicillin"],
    medications: ["Lisinopril 10mg"],
    medicalAlerts: ["Hypertension"],
    lastVisitDate: "2026-02-15",
  },
  {
    ehrPatientId: "mock-1002",
    firstName: "Michael",
    lastName: "Chen",
    dateOfBirth: "1992-07-22",
    phone: "555-0102",
    email: "m.chen@example.com",
    insurance: { carrier: "MetLife", subscriberId: "ML-67890", planType: "HMO" },
    lastVisitDate: "2026-01-20",
  },
  {
    ehrPatientId: "mock-1003",
    firstName: "Emily",
    lastName: "Rodriguez",
    dateOfBirth: "1978-11-08",
    phone: "555-0103",
    allergies: ["Latex", "Codeine"],
    medicalAlerts: ["Diabetes Type 2", "Anticoagulant therapy"],
    lastVisitDate: "2026-03-01",
  },
];

const MOCK_APPOINTMENTS: EhrAppointment[] = [
  {
    ehrAppointmentId: "apt-2001",
    patientId: "mock-1001",
    patientName: "Sarah Johnson",
    providerId: "prov-1",
    providerName: "Dr. Smith",
    date: new Date().toISOString().split("T")[0]!,
    startTime: "09:00",
    duration: 60,
    status: "confirmed",
    procedures: [{ code: "D0120", description: "Periodic oral evaluation" }],
  },
  {
    ehrAppointmentId: "apt-2002",
    patientId: "mock-1002",
    patientName: "Michael Chen",
    providerId: "prov-1",
    providerName: "Dr. Smith",
    date: new Date().toISOString().split("T")[0]!,
    startTime: "10:30",
    duration: 90,
    status: "scheduled",
    procedures: [{ code: "D3330", description: "Root canal - molar" }],
  },
  {
    ehrAppointmentId: "apt-2003",
    patientId: "mock-1003",
    patientName: "Emily Rodriguez",
    providerId: "prov-2",
    providerName: "Dr. Lee",
    date: new Date().toISOString().split("T")[0]!,
    startTime: "14:00",
    duration: 45,
    status: "checked_in",
    procedures: [{ code: "D2740", description: "Crown - porcelain/ceramic" }],
  },
];

let pushCounter = 0;

export class MockEhrAdapter implements IEhrAdapter {
  readonly system = "mock" as const;

  async testConnection(_config: EhrConnectionConfig): Promise<{ connected: boolean; version?: string; error?: string }> {
    return { connected: true, version: "mock-1.0.0" };
  }

  async searchPatients(_config: EhrConnectionConfig, query: { name?: string; dob?: string; phone?: string }): Promise<EhrPatient[]> {
    return MOCK_PATIENTS.filter(p => {
      if (query.name) {
        const q = query.name.toLowerCase();
        if (!p.firstName.toLowerCase().includes(q) && !p.lastName.toLowerCase().includes(q)) return false;
      }
      if (query.dob && p.dateOfBirth !== query.dob) return false;
      if (query.phone && !p.phone?.includes(query.phone)) return false;
      return true;
    });
  }

  async getPatient(_config: EhrConnectionConfig, ehrPatientId: string): Promise<EhrPatient | null> {
    return MOCK_PATIENTS.find(p => p.ehrPatientId === ehrPatientId) || null;
  }

  async getAppointments(_config: EhrConnectionConfig, params: { startDate: string; endDate: string; providerId?: string }): Promise<EhrAppointment[]> {
    return MOCK_APPOINTMENTS.filter(a => {
      if (a.date < params.startDate || a.date > params.endDate) return false;
      if (params.providerId && a.providerId !== params.providerId) return false;
      return true;
    });
  }

  async getTodayAppointments(_config: EhrConnectionConfig, providerId?: string): Promise<EhrAppointment[]> {
    const today = new Date().toISOString().split("T")[0]!;
    return this.getAppointments(_config, { startDate: today, endDate: today, providerId });
  }

  async pushClinicalNote(_config: EhrConnectionConfig, _note: EhrClinicalNote): Promise<EhrSyncResult> {
    pushCounter++;
    return {
      success: true,
      ehrRecordId: `mock-note-${pushCounter}`,
      timestamp: new Date().toISOString(),
    };
  }

  async getPatientTreatmentPlans(_config: EhrConnectionConfig, patientId: string): Promise<EhrTreatmentPlan[]> {
    if (patientId !== "mock-1001") return [];
    return [{
      ehrPlanId: "tp-3001",
      patientId,
      providerId: "prov-1",
      status: "accepted",
      phases: [{
        phase: 1,
        description: "Restorative",
        procedures: [
          { code: "D2391", description: "Composite - 1 surface", toothNumber: "14", fee: 250, insuranceEstimate: 175, patientEstimate: 75 },
          { code: "D2392", description: "Composite - 2 surfaces", toothNumber: "19", fee: 325, insuranceEstimate: 225, patientEstimate: 100 },
        ],
      }],
      totalFee: 575,
      totalInsurance: 400,
      totalPatient: 175,
      createdAt: "2026-02-01",
    }];
  }
}
