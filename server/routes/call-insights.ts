/**
 * Call Insights routes: speech analytics, self-review, score disputes,
 * referral letters, patient summaries, and auto-suggested billing codes.
 *
 * These extend the core call analysis with competitive features.
 */
import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { storage } from "../storage";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { getOrgAIProvider } from "../services/ai-factory";
import { errorResponse, ERROR_CODES } from "../services/error-codes";

/** Extract JSON from AI text response (handles markdown fences, extra text) */
function extractJson(text: string): Record<string, unknown> | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* not valid JSON */ }
  return null;
}

/** Generate text using the org's AI provider (uses generateText if available, falls back to analyzeCallTranscript) */
async function generateWithProvider(orgId: string, prompt: string): Promise<string> {
  const provider = await getOrgAIProvider(orgId);
  if (provider.generateText) {
    return await provider.generateText(prompt);
  }
  // Fallback: use analyzeCallTranscript with the prompt as "transcript"
  const result = await provider.analyzeCallTranscript(prompt, "insight-generation");
  return typeof result === "string" ? result : JSON.stringify(result);
}

export function registerCallInsightRoutes(app: Express): void {

  // ==================== SPEECH ANALYTICS ====================

  // GET speech metrics for a call (already stored in analysis, but convenient endpoint)
  app.get("/api/calls/:id/speech-metrics", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }
      res.json((analysis as any).speechMetrics || null);
    } catch (error) {
      logger.error({ err: error }, "Failed to get speech metrics");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to get speech metrics"));
    }
  });

  // ==================== SELF-REVIEW ====================

  // POST: Agent submits a self-review for their own call
  app.post("/api/calls/:id/self-review", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const selfReviewSchema = z.object({
        score: z.number().min(0).max(10),
        notes: z.string().max(2000).optional(),
      });
      const parsed = selfReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid self-review data", errors: parsed.error.flatten() });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }

      const selfReview = {
        score: parsed.data.score,
        notes: parsed.data.notes || "",
        reviewedAt: new Date().toISOString(),
        reviewedBy: req.user?.id || "unknown",
      };

      await storage.createCallAnalysis(req.orgId!, { ...analysis, selfReview } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "self_review_submitted",
        resourceType: "call_analysis",
        resourceId: req.params.id,
        detail: `Self-review score: ${parsed.data.score}`,
      });

      res.json({ success: true, selfReview });
    } catch (error) {
      logger.error({ err: error }, "Failed to submit self-review");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to submit self-review"));
    }
  });

  // ==================== SCORE DISPUTE ====================

  // POST: Agent disputes a QA score
  app.post("/api/calls/:id/dispute", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const disputeSchema = z.object({
        reason: z.string().min(10).max(2000),
      });
      const parsed = disputeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid dispute data", errors: parsed.error.flatten() });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }

      const existingDispute = (analysis as any).scoreDispute;
      if (existingDispute && existingDispute.status !== "rejected") {
        res.status(409).json({ message: "A dispute is already open for this call" });
        return;
      }

      const scoreDispute = {
        status: "open" as const,
        reason: parsed.data.reason,
        disputedBy: req.user?.id || "unknown",
        disputedAt: new Date().toISOString(),
        originalScore: analysis.performanceScore ? parseFloat(analysis.performanceScore) : undefined,
      };

      await storage.createCallAnalysis(req.orgId!, { ...analysis, scoreDispute } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "score_dispute_opened",
        resourceType: "call_analysis",
        resourceId: req.params.id,
        detail: `Dispute reason: ${parsed.data.reason.slice(0, 100)}`,
      });

      res.json({ success: true, scoreDispute });
    } catch (error) {
      logger.error({ err: error }, "Failed to open score dispute");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to open score dispute"));
    }
  });

  // PATCH: Manager resolves a score dispute
  app.patch("/api/calls/:id/dispute", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const resolveSchema = z.object({
        status: z.enum(["accepted", "rejected"]),
        resolution: z.string().max(2000).optional(),
        adjustedScore: z.number().min(0).max(10).optional(),
      });
      const parsed = resolveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid resolution data", errors: parsed.error.flatten() });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      const existingDispute = (analysis as any)?.scoreDispute;
      if (!existingDispute) {
        res.status(404).json({ message: "No dispute found for this call" });
        return;
      }

      if (existingDispute.status !== "open" && existingDispute.status !== "under_review") {
        res.status(409).json({ message: "Dispute is already resolved" });
        return;
      }

      const updatedDispute = {
        ...existingDispute,
        status: parsed.data.status,
        resolution: parsed.data.resolution || "",
        resolvedBy: req.user?.id || "unknown",
        resolvedAt: new Date().toISOString(),
        adjustedScore: parsed.data.adjustedScore,
      };

      const updatedAnalysis: Record<string, unknown> = { ...analysis, scoreDispute: updatedDispute };

      // If accepted and adjustedScore provided, update the performance score
      if (parsed.data.status === "accepted" && parsed.data.adjustedScore !== undefined) {
        updatedAnalysis.performanceScore = parsed.data.adjustedScore.toString();
      }

      await storage.createCallAnalysis(req.orgId!, updatedAnalysis as any);

      logPhiAccess({
        ...auditContext(req),
        event: "score_dispute_resolved",
        resourceType: "call_analysis",
        resourceId: req.params.id,
        detail: `Dispute ${parsed.data.status}${parsed.data.adjustedScore ? `, adjusted to ${parsed.data.adjustedScore}` : ""}`,
      });

      res.json({ success: true, scoreDispute: updatedDispute });
    } catch (error) {
      logger.error({ err: error }, "Failed to resolve score dispute");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to resolve score dispute"));
    }
  });

  // ==================== REFERRAL LETTER GENERATION ====================

  // POST: Generate a referral letter from a call's clinical note
  app.post("/api/calls/:id/referral-letter", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const referralSchema = z.object({
        referToSpecialty: z.string().min(1).max(200),
        referToProvider: z.string().max(200).optional(),
        additionalContext: z.string().max(1000).optional(),
      });
      const parsed = referralSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid referral letter request", errors: parsed.error.flatten() });
        return;
      }

      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }

      const transcript = await storage.getTranscript(req.orgId!, req.params.id);

      const prompt = `Generate a professional clinical referral letter based on the following encounter information.

ENCOUNTER SUMMARY:
${analysis.summary || "Not available"}

CLINICAL NOTE:
${analysis.clinicalNote ? JSON.stringify(analysis.clinicalNote, null, 2) : "Not available"}

TRANSCRIPT EXCERPT:
${transcript?.text?.slice(0, 2000) || "Not available"}

REFERRAL TO: ${parsed.data.referToSpecialty}${parsed.data.referToProvider ? ` (Dr. ${parsed.data.referToProvider})` : ""}
${parsed.data.additionalContext ? `ADDITIONAL CONTEXT: ${parsed.data.additionalContext}` : ""}

Generate a formal referral letter that includes:
1. Patient presentation and chief complaint
2. Relevant history and findings from this encounter
3. Reason for referral
4. Any relevant test results or imaging
5. Urgency level (routine, urgent, emergent)
6. Requesting provider signature block

Return as JSON: { "letter": "full letter text", "urgency": "routine|urgent|emergent" }`;

      const result = await generateWithProvider(req.orgId!, prompt);
      const jsonResult = extractJson(result);
      const letter = (jsonResult?.letter as string) || result;
      const urgency = (jsonResult?.urgency as string) || "routine";

      await storage.createCallAnalysis(req.orgId!, { ...analysis, referralLetter: letter } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "referral_letter_generated",
        resourceType: "call_analysis",
        resourceId: req.params.id,
        detail: `Referral to ${parsed.data.referToSpecialty}`,
      });

      res.json({ success: true, referralLetter: letter, urgency });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate referral letter");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate referral letter"));
    }
  });

  // ==================== PATIENT VISIT SUMMARY ====================

  // POST: Generate a patient-facing plain-language visit summary
  app.post("/api/calls/:id/patient-summary", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }

      const prompt = `Generate a patient-friendly visit summary in plain, non-medical language.

ENCOUNTER SUMMARY:
${analysis.summary || "Not available"}

CLINICAL NOTE:
${analysis.clinicalNote ? JSON.stringify(analysis.clinicalNote, null, 2) : "Not available"}

Write a clear, compassionate summary that a patient can understand. Include:
1. What was discussed during the visit (in simple terms)
2. Any diagnoses or findings (explained simply)
3. Treatment plan or next steps
4. Any medications discussed
5. Follow-up instructions
6. When to seek immediate care

Use warm, reassuring language. Avoid medical jargon. If dental, explain procedures in everyday terms.
Keep it under 500 words.

Return as JSON: { "summary": "the patient-friendly summary text" }`;

      const result = await generateWithProvider(req.orgId!, prompt);
      const jsonResult = extractJson(result);
      const summary = (jsonResult?.summary as string) || result;

      await storage.createCallAnalysis(req.orgId!, { ...analysis, patientSummary: summary } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "patient_summary_generated",
        resourceType: "call_analysis",
        resourceId: req.params.id,
      });

      res.json({ success: true, patientSummary: summary });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate patient summary");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to generate patient summary"));
    }
  });

  // ==================== AUTO-SUGGESTED BILLING CODES ====================

  // POST: Generate suggested billing codes from transcript/analysis
  app.post("/api/calls/:id/suggest-billing-codes", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json(errorResponse(ERROR_CODES.CALL_NOT_FOUND, "Call analysis not found"));
        return;
      }

      const transcript = await storage.getTranscript(req.orgId!, req.params.id);
      const org = await storage.getOrganization(req.orgId!);
      const isDental = org?.settings?.industryType === "dental" || false;

      const prompt = `Analyze this clinical encounter and suggest appropriate billing codes.

ENCOUNTER SUMMARY:
${analysis.summary || "Not available"}

CLINICAL NOTE:
${analysis.clinicalNote ? JSON.stringify(analysis.clinicalNote, null, 2) : "Not available"}

TRANSCRIPT EXCERPT:
${transcript?.text?.slice(0, 3000) || "Not available"}

INDUSTRY: ${org?.settings?.industryType || "general"}

${isDental ? `Suggest CDT (dental procedure) codes AND ICD-10 codes where appropriate.
Common dental CDT categories: D0100-D0999 (diagnostic), D1000-D1999 (preventive), D2000-D2999 (restorative), D4000-D4999 (periodontics), D7000-D7999 (oral surgery).` : `Suggest CPT and ICD-10 codes.`}

For each code, provide:
- The code number
- Description
- Confidence level (0.0 to 1.0) based on how clearly the transcript supports this code

Return as JSON:
{
  "cptCodes": [{ "code": "99213", "description": "Office visit, established patient, low complexity", "confidence": 0.9 }],
  "icd10Codes": [{ "code": "K02.9", "description": "Dental caries, unspecified", "confidence": 0.8 }],
  "cdtCodes": [{ "code": "D0120", "description": "Periodic oral evaluation", "confidence": 0.95 }]
}

Only include codes you have reasonable confidence in (>= 0.5). These are suggestions — always require provider review.`;

      const result = await generateWithProvider(req.orgId!, prompt);
      const suggestedCodes = extractJson(result) || {};

      // Validate and normalize the response
      const normalized = {
        cptCodes: Array.isArray(suggestedCodes.cptCodes) ? (suggestedCodes.cptCodes as any[]).filter(
          (c) => c.code && c.description && typeof c.confidence === "number"
        ) : [],
        icd10Codes: Array.isArray(suggestedCodes.icd10Codes) ? (suggestedCodes.icd10Codes as any[]).filter(
          (c) => c.code && c.description && typeof c.confidence === "number"
        ) : [],
        cdtCodes: Array.isArray(suggestedCodes.cdtCodes) ? (suggestedCodes.cdtCodes as any[]).filter(
          (c) => c.code && c.description && typeof c.confidence === "number"
        ) : [],
      };

      await storage.createCallAnalysis(req.orgId!, { ...analysis, suggestedBillingCodes: normalized } as any);

      logPhiAccess({
        ...auditContext(req),
        event: "billing_codes_suggested",
        resourceType: "call_analysis",
        resourceId: req.params.id,
        detail: `Suggested: ${normalized.cptCodes.length} CPT, ${normalized.icd10Codes.length} ICD-10, ${normalized.cdtCodes.length} CDT`,
      });

      res.json({ success: true, suggestedBillingCodes: normalized });
    } catch (error) {
      logger.error({ err: error }, "Failed to suggest billing codes");
      res.status(500).json(errorResponse(ERROR_CODES.INTERNAL_ERROR, "Failed to suggest billing codes"));
    }
  });
}
