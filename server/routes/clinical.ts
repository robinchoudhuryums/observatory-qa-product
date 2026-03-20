import type { Express } from "express";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { decryptField, encryptField } from "../services/phi-encryption";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";
import { analyzeProviderStyle, type ClinicalNote as StyleClinicalNote } from "../services/style-learning";
import {
  getTemplatesBySpecialty, getTemplatesByFormat, getTemplatesByCategory,
  getTemplateById, searchTemplates, CLINICAL_NOTE_TEMPLATES,
} from "../services/clinical-templates";
import {
  validateClinicalNote, getRecommendedFormat, getRequiredSections,
} from "../services/clinical-validation";

/**
 * Middleware to ensure the org has clinical documentation enabled.
 */
function requireClinicalPlan() {
  return async (req: any, res: any, next: any) => {
    const orgId = req.orgId;
    if (!orgId) return next();

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];

      if (!plan?.limits?.clinicalDocumentationEnabled) {
        res.status(403).json({
          message: "Clinical documentation requires a Clinical plan",
          code: "OBS-BILLING-010",
          upgrade: true,
        });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}

export function registerClinicalRoutes(app: Express): void {
  // Get clinical notes for a specific call
  app.get("/api/clinical/notes/:callId", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis) {
        res.status(404).json({ message: "Analysis not found" });
        return;
      }

      const cn = (analysis as any).clinicalNote;
      if (!cn) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "view_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
      });

      // Decrypt PHI fields
      if (typeof cn.subjective === "string") cn.subjective = decryptField(cn.subjective);
      if (typeof cn.objective === "string") cn.objective = decryptField(cn.objective);
      if (typeof cn.assessment === "string") cn.assessment = decryptField(cn.assessment);
      if (typeof cn.hpiNarrative === "string") cn.hpiNarrative = decryptField(cn.hpiNarrative);
      if (typeof cn.chiefComplaint === "string") cn.chiefComplaint = decryptField(cn.chiefComplaint);

      res.json(cn);
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical note");
      res.status(500).json({ message: "Failed to get clinical note" });
    }
  });

  // Provider attestation — mark clinical note as reviewed and attested
  app.post("/api/clinical/notes/:callId/attest", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Verify the attesting user is the provider who should attest this note.
      // Admins can attest on behalf of others (override); managers must be the
      // provider associated with the encounter or the one who last edited it.
      const currentUserName = (req as any).user?.name || (req as any).user?.username;
      const currentUserRole = (req as any).user?.role;
      const noteCreator = analysis.clinicalNote.attestedBy // previously attested by
        || analysis.clinicalNote.editHistory?.at(-1)?.editedBy; // or last editor

      if (currentUserRole !== "admin" && noteCreator && noteCreator !== currentUserName) {
        res.status(403).json({
          message: "Only the treating provider or an admin can attest this clinical note",
          attestedBy: noteCreator,
        });
        return;
      }

      analysis.clinicalNote.providerAttested = true;
      analysis.clinicalNote.attestedBy = currentUserName;
      analysis.clinicalNote.attestedAt = new Date().toISOString();

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "attest_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Provider ${currentUserName} attested clinical note`,
      });

      logger.info({ callId: req.params.callId }, "Clinical note attested by provider");
      res.json({ success: true, attestedAt: analysis.clinicalNote.attestedAt });
    } catch (error) {
      logger.error({ err: error }, "Failed to attest clinical note");
      res.status(500).json({ message: "Failed to attest clinical note" });
    }
  });

  // Record patient consent
  app.post("/api/clinical/notes/:callId/consent", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { consentObtained } = req.body;
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      analysis.clinicalNote.patientConsentObtained = !!consentObtained;
      analysis.clinicalNote.consentRecordedBy = (req as any).user?.name || (req as any).user?.username;
      analysis.clinicalNote.consentRecordedAt = new Date().toISOString();

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "record_patient_consent",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Consent: ${consentObtained}`,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to record patient consent");
      res.status(500).json({ message: "Failed to record patient consent" });
    }
  });

  // Edit clinical note fields (provider correction before attestation)
  app.patch("/api/clinical/notes/:callId", requireAuth, injectOrgContext, requireClinicalPlan(), requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId) as any;
      if (!analysis?.clinicalNote) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Don't allow editing attested notes without re-attestation
      if (analysis.clinicalNote.providerAttested) {
        analysis.clinicalNote.providerAttested = false;
        analysis.clinicalNote.attestedBy = undefined;
        analysis.clinicalNote.attestedAt = undefined;
      }

      const allowedFields = [
        "chiefComplaint", "subjective", "objective", "assessment", "plan",
        "hpiNarrative", "reviewOfSystems", "differentialDiagnoses",
        "icd10Codes", "cptCodes", "cdtCodes", "prescriptions", "followUp",
        "toothNumbers", "quadrants", "periodontalFindings", "treatmentPhases",
        "format", "specialty",
      ];

      const edits: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          edits[field] = req.body[field];
        }
      }

      // Warn if format change would orphan existing sections
      if (edits.format && edits.format !== analysis.clinicalNote.format) {
        const newRequired = getRequiredSections(edits.format as string);
        const oldRequired = getRequiredSections(analysis.clinicalNote.format || "soap");
        const lostSections = oldRequired.filter(s => !newRequired.includes(s));
        if (lostSections.length > 0) {
          logger.info({
            callId: req.params.callId,
            oldFormat: analysis.clinicalNote.format,
            newFormat: edits.format,
            lostSections,
          }, "Clinical note format change — some sections may be lost");
        }
      }

      // Track all edited field names before PHI fields are separated
      const allEditedFields = Object.keys(req.body).filter(k => allowedFields.includes(k));

      // Encrypt PHI fields before storage
      const phiFields = ["subjective", "objective", "assessment", "hpiNarrative", "chiefComplaint"];
      for (const field of phiFields) {
        if (typeof edits[field] === "string") {
          analysis.clinicalNote[field] = encryptField(edits[field] as string);
          delete edits[field]; // Already handled via encryption
        }
      }

      // Apply non-PHI edits directly
      Object.assign(analysis.clinicalNote, edits);

      // Track edit history (includes both PHI and non-PHI field names, never PHI values)
      if (!analysis.clinicalNote.editHistory) {
        analysis.clinicalNote.editHistory = [];
      }
      analysis.clinicalNote.editHistory.push({
        editedBy: (req as any).user?.name || (req as any).user?.username,
        editedAt: new Date().toISOString(),
        fieldsChanged: allEditedFields,
      });

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "edit_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: `Edited fields: ${allEditedFields.join(", ")}`,
      });

      logger.info({ callId: req.params.callId, fields: Object.keys(edits) }, "Clinical note edited");
      res.json({ success: true, message: "Clinical note updated. Re-attestation required." });
    } catch (error) {
      logger.error({ err: error }, "Failed to edit clinical note");
      res.status(500).json({ message: "Failed to edit clinical note" });
    }
  });

  // Get/update provider style preferences for clinical note generation
  app.get("/api/clinical/provider-preferences", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      const userId = (req as any).user?.id || "unknown";
      const prefs = (org?.settings as any)?.providerStylePreferences?.[userId] || {};
      res.json(prefs);
    } catch (error) {
      logger.error({ err: error }, "Failed to get provider preferences");
      res.status(500).json({ message: "Failed to get provider preferences" });
    }
  });

  app.patch("/api/clinical/provider-preferences", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const userId = (req as any).user?.id || "unknown";
      const allowedPrefFields = [
        "noteFormat", "sectionOrder", "abbreviationLevel",
        "includeNegativePertinents", "defaultSpecialty",
        "customSections", "templateOverrides",
      ];

      const updates: Record<string, unknown> = {};
      for (const field of allowedPrefFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const settings = org.settings || {};
      const allPrefs = (settings as any).providerStylePreferences || {};
      allPrefs[userId] = { ...allPrefs[userId], ...updates };

      await storage.updateOrganization(req.orgId!, {
        settings: { ...settings, providerStylePreferences: allPrefs } as any,
      });

      logger.info({ orgId: req.orgId, userId, fields: Object.keys(updates) }, "Provider style preferences updated");
      res.json({ success: true, preferences: allPrefs[userId] });
    } catch (error) {
      logger.error({ err: error }, "Failed to update provider preferences");
      res.status(500).json({ message: "Failed to update provider preferences" });
    }
  });

  // Get clinical dashboard metrics (enhanced)
  app.get("/api/clinical/metrics", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const calls = await storage.getCallsWithDetails(req.orgId!, {});
      const clinicalCategories = [
        "clinical_encounter", "telemedicine",
        "dental_encounter", "dental_consultation",
      ];
      const clinicalCalls = calls.filter((c: any) =>
        clinicalCategories.includes(c.callCategory)
      );

      const completed = clinicalCalls.filter((c: any) => c.status === "completed");
      const withNotes = completed.filter((c: any) => c.analysis?.clinicalNote);
      const attested = withNotes.filter((c: any) => c.analysis?.clinicalNote?.providerAttested);

      const avgCompleteness = withNotes.length > 0
        ? withNotes.reduce((sum: number, c: any) => sum + (c.analysis?.clinicalNote?.documentationCompleteness || 0), 0) / withNotes.length
        : 0;

      const avgAccuracy = withNotes.length > 0
        ? withNotes.reduce((sum: number, c: any) => sum + (c.analysis?.clinicalNote?.clinicalAccuracy || 0), 0) / withNotes.length
        : 0;

      // Enhanced: format distribution
      const formatDist: Record<string, number> = {};
      for (const c of withNotes) {
        const fmt = (c as any).analysis?.clinicalNote?.format || "soap";
        formatDist[fmt] = (formatDist[fmt] || 0) + 1;
      }

      // Enhanced: specialty distribution
      const specialtyDist: Record<string, number> = {};
      for (const c of withNotes) {
        const sp = (c as any).analysis?.clinicalNote?.specialty || "unspecified";
        specialtyDist[sp] = (specialtyDist[sp] || 0) + 1;
      }

      // Enhanced: attestation trend (last 7 days)
      const now = new Date();
      const attestationTrend: Array<{ date: string; attested: number; total: number }> = [];
      for (let d = 6; d >= 0; d--) {
        const day = new Date(now);
        day.setDate(day.getDate() - d);
        const dayStr = day.toISOString().split("T")[0];
        const dayNotes = withNotes.filter((c: any) => {
          const uploaded = c.uploadedAt ? new Date(c.uploadedAt).toISOString().split("T")[0] : "";
          return uploaded === dayStr;
        });
        const dayAttested = dayNotes.filter((c: any) => c.analysis?.clinicalNote?.providerAttested);
        attestationTrend.push({ date: dayStr, attested: dayAttested.length, total: dayNotes.length });
      }

      // Enhanced: completeness distribution (buckets 0-2, 2-4, 4-6, 6-8, 8-10)
      const completenessDist = [0, 0, 0, 0, 0];
      for (const c of withNotes) {
        const score = (c as any).analysis?.clinicalNote?.documentationCompleteness || 0;
        const bucket = Math.min(4, Math.floor(score / 2));
        completenessDist[bucket]++;
      }

      // Enhanced: avg time to attestation
      let totalAttestTime = 0;
      let attestTimeCount = 0;
      for (const c of attested) {
        const cn = (c as any).analysis?.clinicalNote;
        if (cn?.attestedAt && (c as any).uploadedAt) {
          const diff = new Date(cn.attestedAt).getTime() - new Date((c as any).uploadedAt).getTime();
          if (diff > 0) {
            totalAttestTime += diff;
            attestTimeCount++;
          }
        }
      }
      const avgAttestationTimeMinutes = attestTimeCount > 0
        ? Math.round(totalAttestTime / attestTimeCount / 60000)
        : null;

      res.json({
        totalEncounters: clinicalCalls.length,
        completedEncounters: completed.length,
        notesGenerated: withNotes.length,
        notesAttested: attested.length,
        pendingAttestation: withNotes.length - attested.length,
        avgDocumentationCompleteness: Math.round(avgCompleteness * 10) / 10,
        avgClinicalAccuracy: Math.round(avgAccuracy * 10) / 10,
        attestationRate: withNotes.length > 0 ? Math.round((attested.length / withNotes.length) * 100) : 0,
        avgAttestationTimeMinutes,
        formatDistribution: formatDist,
        specialtyDistribution: specialtyDist,
        attestationTrend,
        completenessDistribution: completenessDist.map((count, i) => ({
          range: `${i * 2}-${i * 2 + 2}`,
          count,
        })),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical metrics");
      res.status(500).json({ message: "Failed to get clinical metrics" });
    }
  });

  // ==================== STYLE LEARNING ====================

  // Analyze provider's past notes and suggest style preferences
  app.post("/api/clinical/style-learning/analyze", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const userId = (req as any).user?.id || "unknown";
      const calls = await storage.getCallsWithDetails(req.orgId!, {});
      const clinicalCategories = [
        "clinical_encounter", "telemedicine",
        "dental_encounter", "dental_consultation",
      ];

      // Gather attested notes for this provider
      const attestedNotes: StyleClinicalNote[] = [];
      for (const call of calls) {
        const cn = (call as any).analysis?.clinicalNote;
        if (!cn?.providerAttested) continue;
        if (!clinicalCategories.includes((call as any).callCategory)) continue;

        // Only include notes attested by this user (if tracked)
        if (cn.attestedBy) {
          const userName = (req as any).user?.name || (req as any).user?.username;
          if (cn.attestedBy !== userName) continue;
        }

        const sections: Record<string, string> = {};
        if (cn.subjective) sections.subjective = decryptField(cn.subjective);
        if (cn.objective) sections.objective = decryptField(cn.objective);
        if (cn.assessment) sections.assessment = decryptField(cn.assessment);
        if (cn.plan) sections.plan = Array.isArray(cn.plan) ? cn.plan.join("\n") : cn.plan;
        if (cn.hpiNarrative) sections.hpiNarrative = decryptField(cn.hpiNarrative);
        if (cn.data) sections.data = cn.data;
        if (cn.behavior) sections.behavior = cn.behavior;
        if (cn.intervention) sections.intervention = cn.intervention;
        if (cn.response) sections.response = cn.response;

        attestedNotes.push({
          attestedAt: cn.attestedAt || (call as any).uploadedAt || new Date().toISOString(),
          specialty: cn.specialty,
          sections,
        });
      }

      const result = analyzeProviderStyle(req.orgId!, userId, attestedNotes);

      if (!result) {
        res.json({
          success: false,
          message: `Need at least 3 attested notes for style analysis (found ${attestedNotes.length})`,
          noteCount: attestedNotes.length,
        });
        return;
      }

      logger.info({ orgId: req.orgId, userId, noteCount: attestedNotes.length }, "Style learning analysis completed");
      res.json({ success: true, analysis: result, noteCount: attestedNotes.length });
    } catch (error) {
      logger.error({ err: error }, "Failed to analyze provider style");
      res.status(500).json({ message: "Failed to analyze provider style" });
    }
  });

  // Apply learned style preferences
  app.post("/api/clinical/style-learning/apply", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { preferences } = req.body;
      if (!preferences || typeof preferences !== "object") {
        res.status(400).json({ message: "preferences object is required" });
        return;
      }

      const org = await storage.getOrganization(req.orgId!);
      if (!org) {
        res.status(404).json({ message: "Organization not found" });
        return;
      }

      const userId = (req as any).user?.id || "unknown";
      const settings = org.settings || {};
      const allPrefs = (settings as any).providerStylePreferences || {};
      allPrefs[userId] = { ...allPrefs[userId], ...preferences, learnedAt: new Date().toISOString() };

      await storage.updateOrganization(req.orgId!, {
        settings: { ...settings, providerStylePreferences: allPrefs } as any,
      });

      logger.info({ orgId: req.orgId, userId }, "Applied learned style preferences");
      res.json({ success: true, preferences: allPrefs[userId] });
    } catch (error) {
      logger.error({ err: error }, "Failed to apply learned preferences");
      res.status(500).json({ message: "Failed to apply learned preferences" });
    }
  });

  // ==================== CLINICAL NOTE TEMPLATES ====================

  // List all templates (with optional filtering)
  app.get("/api/clinical/templates", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const { specialty, format, category, search } = req.query;

      let templates;
      if (search && typeof search === "string") {
        templates = searchTemplates(search);
      } else if (specialty && typeof specialty === "string") {
        templates = getTemplatesBySpecialty(specialty);
      } else if (format && typeof format === "string") {
        templates = getTemplatesByFormat(format);
      } else if (category && typeof category === "string") {
        templates = getTemplatesByCategory(category);
      } else {
        templates = CLINICAL_NOTE_TEMPLATES;
      }

      res.json(templates);
    } catch (error) {
      logger.error({ err: error }, "Failed to list clinical templates");
      res.status(500).json({ message: "Failed to list clinical templates" });
    }
  });

  // Get recommended format for a specialty
  app.get("/api/clinical/recommended-format", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    const { specialty } = req.query;
    if (!specialty || typeof specialty !== "string") {
      res.status(400).json({ message: "specialty query parameter is required" });
      return;
    }
    const format = getRecommendedFormat(specialty);
    const requiredSections = getRequiredSections(format);
    res.json({ specialty, recommendedFormat: format, requiredSections });
  });

  // Validate an existing clinical note
  app.get("/api/clinical/notes/:callId/validate", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.callId);
      if (!analysis) {
        res.status(404).json({ message: "Analysis not found" });
        return;
      }
      const cn = (analysis as any).clinicalNote;
      if (!cn) {
        res.status(404).json({ message: "No clinical note found for this encounter" });
        return;
      }

      // Decrypt PHI fields for validation
      const decrypted = { ...cn };
      if (typeof decrypted.subjective === "string") decrypted.subjective = decryptField(decrypted.subjective);
      if (typeof decrypted.objective === "string") decrypted.objective = decryptField(decrypted.objective);
      if (typeof decrypted.assessment === "string") decrypted.assessment = decryptField(decrypted.assessment);
      if (typeof decrypted.hpiNarrative === "string") decrypted.hpiNarrative = decryptField(decrypted.hpiNarrative);
      if (typeof decrypted.chiefComplaint === "string") decrypted.chiefComplaint = decryptField(decrypted.chiefComplaint);

      const result = validateClinicalNote(decrypted);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to validate clinical note");
      res.status(500).json({ message: "Failed to validate clinical note" });
    }
  });

  // Get a single template by ID
  app.get("/api/clinical/templates/:id", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const template = getTemplateById(req.params.id);
      if (!template) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json(template);
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical template");
      res.status(500).json({ message: "Failed to get clinical template" });
    }
  });
}
