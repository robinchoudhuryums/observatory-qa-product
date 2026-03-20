/**
 * Clinical Note Validation & Utilities
 *
 * Post-generation validation for clinical notes: verifies required sections
 * per format, sanitizes provider style preferences, computes completeness,
 * and provides specialty-to-format mapping.
 */

import { logger } from "./logger";

// --- Required sections per note format ---

const REQUIRED_SECTIONS: Record<string, string[]> = {
  soap: ["chiefComplaint", "subjective", "objective", "assessment", "plan"],
  dap: ["chiefComplaint", "data", "assessment", "plan"],
  birp: ["chiefComplaint", "behavior", "intervention", "response", "plan"],
  hpi_focused: ["chiefComplaint", "hpiNarrative", "assessment", "plan"],
  procedure_note: ["chiefComplaint", "objective", "assessment", "plan"],
};

// --- Specialty → recommended format mapping ---

const SPECIALTY_FORMAT_MAP: Record<string, string> = {
  primary_care: "soap",
  internal_medicine: "soap",
  cardiology: "hpi_focused",
  dermatology: "soap",
  orthopedics: "soap",
  psychiatry: "dap",
  pediatrics: "soap",
  ob_gyn: "soap",
  emergency: "soap",
  urgent_care: "soap",
  general_dentistry: "soap",
  periodontics: "soap",
  endodontics: "procedure_note",
  oral_surgery: "procedure_note",
  orthodontics: "soap",
  prosthodontics: "procedure_note",
  pediatric_dentistry: "soap",
  behavioral_health: "dap",
  general: "soap",
};

/**
 * Get the recommended note format for a given clinical specialty.
 */
export function getRecommendedFormat(specialty: string): string {
  return SPECIALTY_FORMAT_MAP[specialty.toLowerCase()] || "soap";
}

/**
 * Get required sections for a note format.
 */
export function getRequiredSections(format: string): string[] {
  return REQUIRED_SECTIONS[format.toLowerCase()] || REQUIRED_SECTIONS.soap;
}

export interface ClinicalNoteValidationResult {
  valid: boolean;
  format: string;
  missingSections: string[];
  emptySections: string[];
  computedCompleteness: number;
  warnings: string[];
}

/**
 * Validate a clinical note after AI generation.
 * Checks that required sections for the note format are present and non-empty.
 * Returns a validation result with computed completeness score.
 */
export function validateClinicalNote(
  clinicalNote: Record<string, unknown>,
  expectedFormat?: string,
): ClinicalNoteValidationResult {
  const format = (clinicalNote.format as string) || expectedFormat || "soap";
  const required = getRequiredSections(format);
  const warnings: string[] = [];
  const missingSections: string[] = [];
  const emptySections: string[] = [];

  for (const section of required) {
    const value = clinicalNote[section];
    if (value === undefined || value === null) {
      missingSections.push(section);
    } else if (typeof value === "string" && value.trim().length === 0) {
      emptySections.push(section);
    } else if (Array.isArray(value) && value.length === 0) {
      emptySections.push(section);
    }
  }

  // Check documentation quality indicators
  if (clinicalNote.plan) {
    const plan = clinicalNote.plan;
    if (Array.isArray(plan) && plan.length === 0) {
      warnings.push("Plan section is empty — clinical notes should include at least one plan item");
    }
  }

  // Validate ICD-10 code format if present
  const icd10Codes = clinicalNote.icd10Codes || clinicalNote.icd10_codes;
  if (Array.isArray(icd10Codes)) {
    for (const entry of icd10Codes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(code)) {
        warnings.push(`ICD-10 code "${code}" may be invalid (expected format: A00-Z99 with optional decimal)`);
      }
    }
  }

  // Validate CPT code format if present
  const cptCodes = clinicalNote.cptCodes || clinicalNote.cpt_codes;
  if (Array.isArray(cptCodes)) {
    for (const entry of cptCodes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^\d{5}$/.test(code)) {
        warnings.push(`CPT code "${code}" may be invalid (expected 5-digit format)`);
      }
    }
  }

  // Validate CDT code format if present
  const cdtCodes = clinicalNote.cdtCodes || clinicalNote.cdt_codes;
  if (Array.isArray(cdtCodes)) {
    for (const entry of cdtCodes) {
      const code = (entry as any)?.code;
      if (typeof code === "string" && !/^D\d{4}$/.test(code)) {
        warnings.push(`CDT code "${code}" may be invalid (expected D0000-D9999 format)`);
      }
    }
  }

  // Validate tooth numbers (Universal Numbering: 1-32 for permanent, A-T for primary)
  const toothNumbers = clinicalNote.toothNumbers || clinicalNote.tooth_numbers;
  if (Array.isArray(toothNumbers)) {
    for (const tooth of toothNumbers) {
      if (typeof tooth === "string" || typeof tooth === "number") {
        const t = String(tooth).trim();
        const isValid = /^([1-9]|[12]\d|3[0-2])$/.test(t) || /^[A-T]$/.test(t);
        if (!isValid) {
          warnings.push(`Tooth number "${t}" may be invalid (expected 1-32 or A-T)`);
        }
      }
    }
  }

  // Compute completeness: ratio of filled required sections
  const totalRequired = required.length;
  const filled = totalRequired - missingSections.length - emptySections.length;
  const computedCompleteness = totalRequired > 0
    ? Math.round((filled / totalRequired) * 10 * 10) / 10 // 0-10 scale, 1 decimal
    : 0;

  const valid = missingSections.length === 0 && emptySections.length === 0;

  return {
    valid,
    format,
    missingSections,
    emptySections,
    computedCompleteness,
    warnings,
  };
}

// --- Max length for style preference fields to prevent prompt injection ---
const MAX_PREF_STRING_LENGTH = 200;
const MAX_PREF_ARRAY_LENGTH = 10;
const MAX_PREF_ARRAY_ITEM_LENGTH = 100;

/**
 * Sanitize provider style preferences before injecting into AI prompts.
 * Prevents prompt injection via overly long or malicious preference values.
 */
export function sanitizeStylePreferences(prefs: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  // Whitelist of allowed note formats
  const allowedFormats = ["soap", "dap", "birp", "hpi_focused", "procedure_note"];
  if (typeof prefs.noteFormat === "string" && allowedFormats.includes(prefs.noteFormat)) {
    sanitized.noteFormat = prefs.noteFormat;
  }

  // Whitelist of allowed abbreviation levels
  const allowedAbbrevLevels = ["minimal", "moderate", "heavy"];
  if (typeof prefs.abbreviationLevel === "string" && allowedAbbrevLevels.includes(prefs.abbreviationLevel)) {
    sanitized.abbreviationLevel = prefs.abbreviationLevel;
  }

  // Boolean
  if (typeof prefs.includeNegativePertinents === "boolean") {
    sanitized.includeNegativePertinents = prefs.includeNegativePertinents;
  }

  // Specialty — validate against known specialties
  if (typeof prefs.defaultSpecialty === "string") {
    // Strip anything that's not alphanumeric/underscore
    const cleaned = prefs.defaultSpecialty.replace(/[^a-z_]/gi, "").slice(0, 50);
    if (cleaned.length > 0 && SPECIALTY_FORMAT_MAP[cleaned.toLowerCase()]) {
      sanitized.defaultSpecialty = cleaned;
    }
  }

  // Section order — array of short strings
  if (Array.isArray(prefs.sectionOrder)) {
    sanitized.sectionOrder = prefs.sectionOrder
      .filter((s: unknown) => typeof s === "string")
      .slice(0, MAX_PREF_ARRAY_LENGTH)
      .map((s: string) => s.replace(/[^a-zA-Z_ ]/g, "").slice(0, MAX_PREF_ARRAY_ITEM_LENGTH));
  }

  // Custom sections — sanitize to prevent injection
  if (Array.isArray(prefs.customSections)) {
    sanitized.customSections = prefs.customSections
      .filter((s: unknown) => typeof s === "string")
      .slice(0, MAX_PREF_ARRAY_LENGTH)
      .map((s: string) => s.replace(/[^a-zA-Z0-9_ \-\/()]/g, "").slice(0, MAX_PREF_ARRAY_ITEM_LENGTH));
  }

  // Template overrides — sanitize keys and values
  if (typeof prefs.templateOverrides === "object" && prefs.templateOverrides !== null && !Array.isArray(prefs.templateOverrides)) {
    const cleanOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(prefs.templateOverrides as Record<string, unknown>)) {
      const cleanKey = key.replace(/[^a-zA-Z_]/g, "").slice(0, 50);
      if (cleanKey && typeof value === "string") {
        cleanOverrides[cleanKey] = value.slice(0, MAX_PREF_STRING_LENGTH);
      }
    }
    if (Object.keys(cleanOverrides).length > 0) {
      sanitized.templateOverrides = cleanOverrides;
    }
  }

  return sanitized;
}
