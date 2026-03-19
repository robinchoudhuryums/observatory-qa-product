import type { Express } from "express";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { decryptField } from "../services/phi-encryption";
import { PLAN_DEFINITIONS, type PlanTier } from "@shared/schema";

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

      analysis.clinicalNote.providerAttested = true;
      analysis.clinicalNote.attestedBy = (req as any).user?.name || (req as any).user?.username;
      analysis.clinicalNote.attestedAt = new Date().toISOString();

      await storage.createCallAnalysis(req.orgId!, analysis);

      logPhiAccess({
        ...auditContext(req),
        event: "attest_clinical_note",
        resourceType: "clinical_note",
        resourceId: req.params.callId,
        detail: "Provider attested clinical note",
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

  // Get clinical dashboard metrics
  app.get("/api/clinical/metrics", requireAuth, injectOrgContext, requireClinicalPlan(), async (req, res) => {
    try {
      const calls = await storage.getCallsWithDetails(req.orgId!, {});
      const clinicalCalls = calls.filter((c: any) =>
        c.callCategory === "clinical_encounter" || c.callCategory === "telemedicine"
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

      res.json({
        totalEncounters: clinicalCalls.length,
        completedEncounters: completed.length,
        notesGenerated: withNotes.length,
        notesAttested: attested.length,
        pendingAttestation: withNotes.length - attested.length,
        avgDocumentationCompleteness: Math.round(avgCompleteness * 10) / 10,
        avgClinicalAccuracy: Math.round(avgAccuracy * 10) / 10,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get clinical metrics");
      res.status(500).json({ message: "Failed to get clinical metrics" });
    }
  });
}
