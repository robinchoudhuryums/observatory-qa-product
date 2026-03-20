/**
 * EHR Integration API Routes
 *
 * Provides endpoints for connecting dental/medical EHR systems to Observatory QA.
 * Supports: Open Dental, Eaglesoft (Patterson), with Dentrix planned.
 *
 * All endpoints are org-scoped and require admin role for configuration,
 * authenticated access for data retrieval.
 */

import type { Express } from "express";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { getEhrAdapter, getSupportedEhrSystems, type EhrConnectionConfig } from "../services/ehr/index";
import { encryptField, decryptField } from "../services/phi-encryption";

/** Validates EHR baseUrl to prevent SSRF attacks */
function isValidEhrBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Must be HTTPS in production
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return false;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    // Block internal/metadata IPs
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return false;
    if (hostname.startsWith("169.254.")) return false; // AWS metadata
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Decrypt EHR API key from storage */
function decryptEhrApiKey(ehrConfig: any): EhrConnectionConfig {
  return {
    ...ehrConfig,
    apiKey: ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined,
  };
}

export function registerEhrRoutes(app: Express): void {

  // List supported EHR systems
  app.get("/api/ehr/systems", requireAuth, injectOrgContext, (_req, res) => {
    res.json(getSupportedEhrSystems());
  });

  // Get current EHR configuration (redacts sensitive fields)
  app.get("/api/ehr/config", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig;

      if (!ehrConfig) {
        res.json({ configured: false });
        return;
      }

      // Decrypt API key for admin display, redact for non-admins
      const isAdmin = (req as any).user?.role === "admin";
      const decryptedKey = ehrConfig.apiKey ? decryptField(ehrConfig.apiKey) : undefined;
      res.json({
        configured: true,
        system: ehrConfig.system,
        baseUrl: ehrConfig.baseUrl,
        apiKey: isAdmin ? decryptedKey : (ehrConfig.apiKey ? "••••••••" : undefined),
        options: ehrConfig.options,
        enabled: ehrConfig.enabled,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR config");
      res.status(500).json({ message: "Failed to get EHR configuration" });
    }
  });

  // Configure EHR connection (admin only)
  app.put("/api/ehr/config", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { system, baseUrl, apiKey, options } = req.body;

      if (!system || !baseUrl) {
        res.status(400).json({ message: "system and baseUrl are required" });
        return;
      }

      if (!isValidEhrBaseUrl(baseUrl)) {
        res.status(400).json({ message: "Invalid baseUrl. Must be a valid HTTPS URL pointing to an external EHR server." });
        return;
      }

      const adapter = getEhrAdapter(system);
      if (!adapter) {
        res.status(400).json({ message: `Unsupported EHR system: ${system}. Supported: ${getSupportedEhrSystems().map(s => s.system).join(", ")}` });
        return;
      }

      const org = await storage.getOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      // Encrypt API key before storage (HIPAA: credentials at rest)
      const ehrConfig: EhrConnectionConfig & { enabled: boolean } = {
        system,
        baseUrl,
        apiKey: apiKey ? encryptField(apiKey) : undefined,
        options: options || undefined,
        enabled: true,
      };

      await storage.updateOrganization(req.orgId!, {
        settings: { ...org.settings, ehrConfig } as any,
      });

      logger.info({ orgId: req.orgId, system }, "EHR configuration updated");
      res.json({ success: true, system, baseUrl });
    } catch (error) {
      logger.error({ err: error }, "Failed to update EHR config");
      res.status(500).json({ message: "Failed to update EHR configuration" });
    }
  });

  // Test EHR connection
  app.post("/api/ehr/test-connection", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig) {
        res.status(400).json({ message: "No EHR configuration found. Configure your EHR first." });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const result = await adapter.testConnection(decryptEhrApiKey(ehrConfig));
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "EHR connection test failed");
      res.status(500).json({ connected: false, error: "Connection test failed" });
    }
  });

  // Search patients in EHR
  app.get("/api/ehr/patients", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const { name, dob, phone } = req.query;
      if (!name && !dob && !phone) {
        res.status(400).json({ message: "At least one search parameter required: name, dob, or phone" });
        return;
      }

      const patients = await adapter.searchPatients(decryptEhrApiKey(ehrConfig), {
        name: name as string,
        dob: dob as string,
        phone: phone as string,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_patient_search",
        resourceType: "ehr_patient",
        detail: `Searched: ${name || dob || phone}`,
      });

      res.json(patients);
    } catch (error) {
      logger.error({ err: error }, "EHR patient search failed");
      res.status(500).json({ message: "Patient search failed" });
    }
  });

  // Get specific patient from EHR
  app.get("/api/ehr/patients/:ehrPatientId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const patient = await adapter.getPatient(decryptEhrApiKey(ehrConfig), req.params.ehrPatientId);
      if (!patient) {
        res.status(404).json({ message: "Patient not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_patient_view",
        resourceType: "ehr_patient",
        resourceId: req.params.ehrPatientId,
      });

      res.json(patient);
    } catch (error) {
      logger.error({ err: error }, "Failed to get EHR patient");
      res.status(500).json({ message: "Failed to get patient" });
    }
  });

  // Get today's appointments from EHR
  app.get("/api/ehr/appointments/today", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const providerId = req.query.providerId as string | undefined;
      const appointments = await adapter.getTodayAppointments(decryptEhrApiKey(ehrConfig), providerId);
      res.json(appointments);
    } catch (error) {
      logger.error({ err: error }, "Failed to get today's appointments");
      res.status(500).json({ message: "Failed to get appointments" });
    }
  });

  // Get appointments for a date range from EHR
  app.get("/api/ehr/appointments", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const { startDate, endDate, providerId } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ message: "startDate and endDate query parameters required" });
        return;
      }

      const appointments = await adapter.getAppointments(decryptEhrApiKey(ehrConfig), {
        startDate: startDate as string,
        endDate: endDate as string,
        providerId: providerId as string | undefined,
      });
      res.json(appointments);
    } catch (error) {
      logger.error({ err: error }, "Failed to get appointments");
      res.status(500).json({ message: "Failed to get appointments" });
    }
  });

  // Push clinical note to EHR
  app.post("/api/ehr/push-note/:callId", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      // Get the clinical note
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Require attestation before pushing to EHR
      if (!analysis.clinicalNote.providerAttested) {
        res.status(400).json({ message: "Clinical note must be attested before pushing to EHR" });
        return;
      }

      const { ehrPatientId, ehrProviderId } = req.body;
      if (!ehrPatientId) {
        res.status(400).json({ message: "ehrPatientId is required to push note to EHR" });
        return;
      }

      // Decrypt PHI fields before formatting for EHR (stored encrypted at rest)
      const cn = { ...analysis.clinicalNote };
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"];
      for (const f of phiFields) {
        if (typeof cn[f] === "string") cn[f] = decryptField(cn[f]);
      }
      const noteContent = formatClinicalNoteForEhr(cn);

      const result = await adapter.pushClinicalNote(decryptEhrApiKey(ehrConfig), {
        patientId: ehrPatientId,
        providerId: ehrProviderId || "",
        date: new Date().toISOString().split("T")[0]!,
        noteType: cn.format || "soap",
        content: noteContent,
        procedureCodes: cn.cdtCodes || cn.cptCodes,
        diagnosisCodes: cn.icd10Codes,
      });

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_note_push",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Pushed to ${ehrConfig.system}, patient: ${ehrPatientId}`,
      });

      if (result.success) {
        logger.info({ callId: req.params.callId, ehrRecordId: result.ehrRecordId }, "Clinical note pushed to EHR");
      }

      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to push clinical note to EHR");
      res.status(500).json({ success: false, error: "Failed to push note to EHR" });
    }
  });

  // Get patient treatment plans from EHR
  app.get("/api/ehr/patients/:ehrPatientId/treatment-plans", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const ehrConfig = (org?.settings as any)?.ehrConfig as EhrConnectionConfig | undefined;

      if (!ehrConfig?.enabled) {
        res.status(400).json({ message: "EHR integration not configured or disabled" });
        return;
      }

      const adapter = getEhrAdapter(ehrConfig.system);
      if (!adapter) {
        res.status(400).json({ message: `No adapter for EHR system: ${ehrConfig.system}` });
        return;
      }

      const plans = await adapter.getPatientTreatmentPlans(decryptEhrApiKey(ehrConfig), req.params.ehrPatientId);

      logPhiAccess({
        ...auditContext(req),
        event: "ehr_treatment_plan_view",
        resourceType: "ehr_treatment_plan",
        resourceId: req.params.ehrPatientId,
      });

      res.json(plans);
    } catch (error) {
      logger.error({ err: error }, "Failed to get treatment plans");
      res.status(500).json({ message: "Failed to get treatment plans" });
    }
  });

  // Disable EHR integration
  app.delete("/api/ehr/config", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const settings = { ...org.settings } as any;
      if (settings.ehrConfig) {
        settings.ehrConfig.enabled = false;
      }

      await storage.updateOrganization(req.orgId!, { settings });
      logger.info({ orgId: req.orgId }, "EHR integration disabled");
      res.json({ success: true, message: "EHR integration disabled" });
    } catch (error) {
      logger.error({ err: error }, "Failed to disable EHR integration");
      res.status(500).json({ message: "Failed to disable EHR integration" });
    }
  });
}

/**
 * Format a clinical note object into readable text for EHR insertion.
 */
function formatClinicalNoteForEhr(cn: any): string {
  const sections: string[] = [];

  if (cn.chiefComplaint) sections.push(`CHIEF COMPLAINT: ${cn.chiefComplaint}`);
  if (cn.subjective) sections.push(`SUBJECTIVE:\n${cn.subjective}`);
  if (cn.objective) sections.push(`OBJECTIVE:\n${cn.objective}`);
  if (cn.assessment) sections.push(`ASSESSMENT:\n${cn.assessment}`);
  if (cn.plan?.length) sections.push(`PLAN:\n${cn.plan.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n")}`);
  if (cn.hpiNarrative) sections.push(`HPI:\n${cn.hpiNarrative}`);

  if (cn.icd10Codes?.length) {
    sections.push(`DIAGNOSES:\n${cn.icd10Codes.map((c: any) => `${c.code} — ${c.description}`).join("\n")}`);
  }
  if (cn.cdtCodes?.length) {
    sections.push(`PROCEDURES (CDT):\n${cn.cdtCodes.map((c: any) => `${c.code} — ${c.description}`).join("\n")}`);
  }
  if (cn.cptCodes?.length) {
    sections.push(`PROCEDURES (CPT):\n${cn.cptCodes.map((c: any) => `${c.code} — ${c.description}`).join("\n")}`);
  }
  if (cn.prescriptions?.length) {
    sections.push(`PRESCRIPTIONS:\n${cn.prescriptions.map((rx: any) => `${rx.medication} ${rx.dosage || ""} — ${rx.instructions || ""}`).join("\n")}`);
  }
  if (cn.toothNumbers?.length) {
    sections.push(`TEETH INVOLVED: ${cn.toothNumbers.join(", ")}`);
  }
  if (cn.followUp) sections.push(`FOLLOW-UP: ${cn.followUp}`);

  sections.push(`\n--- Generated by Observatory QA (AI Draft — Provider Attested) ---`);

  return sections.join("\n\n");
}
