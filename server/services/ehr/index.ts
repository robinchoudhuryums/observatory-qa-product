/**
 * EHR Adapter Factory
 *
 * Creates the appropriate EHR adapter based on the org's configured EHR system.
 * EHR configuration is stored in org settings under `ehrConfig`.
 *
 * Usage:
 *   const adapter = getEhrAdapter("open_dental");
 *   const patients = await adapter.searchPatients(config, { name: "Smith" });
 */

import type { IEhrAdapter, EhrConnectionConfig } from "./types.js";
import { OpenDentalAdapter } from "./open-dental.js";
import { EaglesoftAdapter } from "./eaglesoft.js";
import { MockEhrAdapter } from "./mock.js";

const adapters: Record<string, IEhrAdapter> = {
  open_dental: new OpenDentalAdapter(),
  eaglesoft: new EaglesoftAdapter(),
  mock: new MockEhrAdapter(),
};

/**
 * Get the EHR adapter for a given system type.
 * Returns null if the system is not supported.
 */
export function getEhrAdapter(system: EhrConnectionConfig["system"]): IEhrAdapter | null {
  return adapters[system] || null;
}

/**
 * List all supported EHR systems.
 */
export function getSupportedEhrSystems(): Array<{ system: string; label: string; status: string }> {
  return [
    { system: "open_dental", label: "Open Dental", status: "available" },
    { system: "eaglesoft", label: "Eaglesoft (Patterson)", status: "available" },
    { system: "dentrix", label: "Dentrix (Henry Schein)", status: "planned" },
    { system: "mock", label: "Mock (Development/Demo)", status: "available" },
  ];
}

export type { IEhrAdapter, EhrConnectionConfig, EhrPatient, EhrAppointment, EhrClinicalNote, EhrTreatmentPlan, EhrSyncResult } from "./types.js";
