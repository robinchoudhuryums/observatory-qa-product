import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { requirePlanFeature } from "./billing";
import { INSURANCE_LETTER_TYPES } from "@shared/schema";

/**
 * Generate an AI-powered insurance narrative letter.
 * Uses the call's clinical note and diagnosis/procedure codes to create
 * a professionally formatted letter for insurers.
 */
async function generateNarrative(params: {
  letterType: string;
  patientName: string;
  insurerName: string;
  diagnosisCodes?: Array<{ code: string; description: string }>;
  procedureCodes?: Array<{ code: string; description: string }>;
  clinicalJustification?: string;
  priorDenialReference?: string;
}): Promise<string> {
  // For now, generate a template-based narrative
  // In production, this would call Bedrock with a specialized prompt
  const { letterType, patientName, insurerName, diagnosisCodes, procedureCodes, clinicalJustification, priorDenialReference } = params;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const letterTypeLabel = INSURANCE_LETTER_TYPES.find(t => t.value === letterType)?.label || letterType;

  let narrative = `${today}\n\nRe: ${letterTypeLabel}\nPatient: ${patientName}\n\nDear ${insurerName} Medical Review Team,\n\n`;

  if (letterType === "prior_auth") {
    narrative += `I am writing to request prior authorization for the following treatment plan for the above-referenced patient.\n\n`;
  } else if (letterType === "appeal") {
    narrative += `I am writing to formally appeal the denial of coverage${priorDenialReference ? ` (Reference: ${priorDenialReference})` : ""} for the above-referenced patient.\n\n`;
  } else if (letterType === "medical_necessity") {
    narrative += `I am writing to establish the medical necessity of the proposed treatment for the above-referenced patient.\n\n`;
  } else if (letterType === "predetermination") {
    narrative += `I am requesting a predetermination of benefits for the following proposed treatment plan.\n\n`;
  } else if (letterType === "peer_to_peer") {
    narrative += `The following summarizes the clinical basis for the proposed treatment, prepared for peer-to-peer review.\n\n`;
  }

  if (clinicalJustification) {
    narrative += `CLINICAL JUSTIFICATION:\n${clinicalJustification}\n\n`;
  }

  if (diagnosisCodes && diagnosisCodes.length > 0) {
    narrative += `DIAGNOSIS CODES:\n`;
    for (const code of diagnosisCodes) {
      narrative += `  - ${code.code}: ${code.description}\n`;
    }
    narrative += `\n`;
  }

  if (procedureCodes && procedureCodes.length > 0) {
    narrative += `PROCEDURE CODES:\n`;
    for (const code of procedureCodes) {
      narrative += `  - ${code.code}: ${code.description}\n`;
    }
    narrative += `\n`;
  }

  narrative += `Based on the clinical findings and established treatment guidelines, the proposed procedures are medically necessary and appropriate for this patient's condition. I respectfully request that coverage be authorized.\n\n`;
  narrative += `Please do not hesitate to contact our office should you require any additional information.\n\nSincerely,\n[Provider Name]\n[Provider Credentials]\n[Practice Name]\n[NPI Number]`;

  return narrative;
}

export function registerInsuranceNarrativeRoutes(app: Express) {
  // List insurance letter types
  app.get("/api/insurance-narratives/types", requireAuth, async (_req, res) => {
    res.json(INSURANCE_LETTER_TYPES);
  });

  // Create a new insurance narrative (optionally linked to a call)
  app.post("/api/insurance-narratives", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId, patientName, patientDob, memberId, insurerName, insurerAddress,
              letterType, diagnosisCodes, procedureCodes, clinicalJustification, priorDenialReference } = req.body;

      if (!patientName || !insurerName || !letterType) {
        return res.status(400).json({ message: "patientName, insurerName, and letterType are required" });
      }

      // If linked to a call, pull clinical data
      let enrichedJustification = clinicalJustification;
      let enrichedDiagnosisCodes = diagnosisCodes;
      let enrichedProcedureCodes = procedureCodes;

      if (callId) {
        const analysis = await storage.getCallAnalysis(orgId, callId);
        if (analysis?.clinicalNote) {
          const note = analysis.clinicalNote as Record<string, unknown>;
          if (!enrichedJustification && note.assessment) {
            enrichedJustification = String(note.assessment);
          }
          if (!enrichedDiagnosisCodes && note.icd10Codes) {
            enrichedDiagnosisCodes = note.icd10Codes;
          }
          if (!enrichedProcedureCodes) {
            enrichedProcedureCodes = (note.cptCodes || note.cdtCodes) as typeof procedureCodes;
          }
        }
      }

      // Generate the narrative
      const generatedNarrative = await generateNarrative({
        letterType, patientName, insurerName,
        diagnosisCodes: enrichedDiagnosisCodes, procedureCodes: enrichedProcedureCodes,
        clinicalJustification: enrichedJustification, priorDenialReference,
      });

      const narrative = await storage.createInsuranceNarrative(orgId, {
        orgId, callId, patientName, patientDob, memberId, insurerName, insurerAddress,
        letterType, diagnosisCodes: enrichedDiagnosisCodes, procedureCodes: enrichedProcedureCodes,
        clinicalJustification: enrichedJustification, priorDenialReference,
        generatedNarrative, status: "draft",
        createdBy: req.user!.name || req.user!.username,
      });

      logger.info({ orgId, narrativeId: narrative.id, letterType }, "Insurance narrative created");
      res.json(narrative);
    } catch (error) {
      logger.error({ err: error }, "Failed to create insurance narrative");
      res.status(500).json({ message: "Failed to create insurance narrative" });
    }
  });

  // List narratives for the org
  app.get("/api/insurance-narratives", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId, status } = req.query;
      const narratives = await storage.listInsuranceNarratives(orgId, {
        callId: callId as string | undefined,
        status: status as string | undefined,
      });
      res.json(narratives);
    } catch (error) {
      logger.error({ err: error }, "Failed to list insurance narratives");
      res.status(500).json({ message: "Failed to list insurance narratives" });
    }
  });

  // Get a specific narrative
  app.get("/api/insurance-narratives/:id", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
      if (!narrative) return res.status(404).json({ message: "Narrative not found" });
      res.json(narrative);
    } catch (error) {
      logger.error({ err: error }, "Failed to get insurance narrative");
      res.status(500).json({ message: "Failed to get insurance narrative" });
    }
  });

  // Update narrative (edit content, change status)
  app.patch("/api/insurance-narratives/:id", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const updated = await storage.updateInsuranceNarrative(orgId, req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Narrative not found" });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update insurance narrative");
      res.status(500).json({ message: "Failed to update insurance narrative" });
    }
  });

  // Delete a narrative
  app.delete("/api/insurance-narratives/:id", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      await storage.deleteInsuranceNarrative(orgId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete insurance narrative");
      res.status(500).json({ message: "Failed to delete insurance narrative" });
    }
  });

  // Regenerate narrative text with updated params
  app.post("/api/insurance-narratives/:id/regenerate", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const narrative = await storage.getInsuranceNarrative(orgId, req.params.id);
      if (!narrative) return res.status(404).json({ message: "Narrative not found" });

      const generatedNarrative = await generateNarrative({
        letterType: narrative.letterType,
        patientName: narrative.patientName,
        insurerName: narrative.insurerName,
        diagnosisCodes: narrative.diagnosisCodes,
        procedureCodes: narrative.procedureCodes,
        clinicalJustification: narrative.clinicalJustification,
        priorDenialReference: narrative.priorDenialReference,
      });

      const updated = await storage.updateInsuranceNarrative(orgId, req.params.id, { generatedNarrative });
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to regenerate insurance narrative");
      res.status(500).json({ message: "Failed to regenerate narrative" });
    }
  });
}
