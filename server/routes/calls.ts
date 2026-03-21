import type { Express } from "express";
import type { PromptTemplateConfig } from "../services/ai-provider";
import { createHash, randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { storage, normalizeAnalysis } from "../storage";
import { assemblyAIService } from "../services/assemblyai";
import { aiProvider } from "../services/ai-factory";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { broadcastCallUpdate } from "../services/websocket";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { notifyFlaggedCall } from "../services/notifications";
import { onCallAnalysisComplete } from "../services/proactive-alerts";
import { trackUsage } from "../services/queue";
import { upload, safeFloat, withRetry } from "./helpers";
import { enforceQuota, requireActiveSubscription } from "./billing";
import { logger } from "../services/logger";
import { searchRelevantChunks, formatRetrievedContext } from "../services/rag";
import { PLAN_DEFINITIONS, CALL_CATEGORIES, type PlanTier, type UsageRecord } from "@shared/schema";
import { estimateBedrockCost, estimateAssemblyAICost } from "./ab-testing";
import { encryptField, decryptField, decryptClinicalNotePhi } from "../services/phi-encryption";
import { calibrateAnalysis } from "../services/scoring-calibration";
import { validateClinicalNote, sanitizeStylePreferences } from "../services/clinical-validation";

// --- Reference document cache (per-org, avoids repeated DB queries) ---
const REF_DOC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
interface RefDocCacheEntry {
  docs: Array<{ name: string; category: string; extractedText: string | null; id: string }>;
  expiresAt: number;
}
const refDocCache = new Map<string, RefDocCacheEntry>();

/** Invalidate cached reference docs for an org (call on doc upload/delete) */
export function invalidateRefDocCache(orgId: string): void {
  refDocCache.delete(orgId);
}

async function getCachedRefDocs(orgId: string, callCategory: string) {
  const cacheKey = `${orgId}:${callCategory}`;
  const cached = refDocCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.docs;

  const docs = await storage.getReferenceDocumentsForCategory(orgId, callCategory);
  refDocCache.set(cacheKey, { docs: docs as any, expiresAt: Date.now() + REF_DOC_CACHE_TTL_MS });
  return docs;
}

// Prune expired ref doc cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(refDocCache)) {
    if (now > entry.expiresAt) refDocCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

// Delete uploaded file after processing
async function cleanupFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    logger.error({ err: error }, "Failed to cleanup file");
  }
}

// Process audio file with AssemblyAI and archive to cloud storage
async function processAudioFile(orgId: string, callId: string, filePath: string, audioBuffer: Buffer, originalName: string, mimeType: string, callCategory?: string, userId?: string, clinicalSpecialty?: string, noteFormat?: string) {
  logger.info({ callId }, "Starting audio processing");
  broadcastCallUpdate(callId, "uploading", { step: 1, totalSteps: 6, label: "Uploading audio..." }, orgId);
  try {
    // Step 1a: Upload to AssemblyAI
    logger.info({ callId, step: "1/7" }, "Uploading audio file to AssemblyAI");
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    logger.info({ callId, step: "1/7" }, "Upload to AssemblyAI successful");

    // Step 1b: Archive audio to cloud storage
    logger.info({ callId, step: "1b/7" }, "Archiving audio file to cloud storage");
    let audioArchived = true;
    try {
      await storage.uploadAudio(orgId, callId, originalName, audioBuffer, mimeType);
      logger.info({ callId, step: "1b/7" }, "Audio archived");
    } catch (archiveError) {
      audioArchived = false;
      logger.warn({ callId, err: archiveError }, "Failed to archive audio (continuing without playback)");
    }

    // Step 2: Start transcription
    broadcastCallUpdate(callId, "transcribing", { step: 2, totalSteps: 6, label: "Transcribing audio..." }, orgId);
    logger.info({ callId, step: "2/7" }, "Submitting for transcription");
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
    logger.info({ callId, step: "2/7", transcriptId }, "Transcription submitted");

    await storage.updateCall(orgId, callId, { assemblyAiId: transcriptId });

    // Step 3: Poll for transcription completion (with progress updates)
    broadcastCallUpdate(callId, "transcribing", { step: 3, totalSteps: 6, label: "Waiting for transcript..." }, orgId);
    logger.info({ callId, step: "3/7" }, "Polling for transcript results");
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId, 60, (attempt, max, status) => {
      const pct = Math.round((attempt / max) * 100);
      broadcastCallUpdate(callId, "transcribing", {
        step: 3, totalSteps: 6, label: `Transcribing... (${status})`, progress: pct,
      }, orgId);
    });

    // --- CRITICAL SAFETY CHECK ---
    if (!transcriptResponse || transcriptResponse.status !== 'completed') {
      throw new Error(`Transcription polling failed or did not complete. Final status: ${transcriptResponse?.status}`);
    }
    // Validate transcript has actual content — empty transcripts produce junk analysis
    if (!transcriptResponse.text || transcriptResponse.text.trim().length < 10) {
      logger.warn({ callId, textLen: transcriptResponse.text?.length || 0 }, "Transcript completed but text is empty or too short");
      broadcastCallUpdate(callId, "completed", {
        step: 6, totalSteps: 6, label: "Complete (no speech detected)",
        warning: "Transcript was empty — audio may be silent, corrupted, or too short",
      }, orgId);
      // Still save what we have but skip AI analysis
      const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, null, callId, orgId);
      analysis.confidenceScore = "0.10";
      analysis.confidenceFactors = {
        transcriptConfidence: 0,
        wordCount: 0,
        callDurationSeconds: 0,
        transcriptLength: 0,
        aiAnalysisCompleted: false,
        overallScore: 0.1,
      };
      (analysis.flags as string[]) = ["empty_transcript", "low_confidence"];
      await Promise.all([
        storage.createTranscript(orgId, transcript),
        storage.createSentimentAnalysis(orgId, sentiment),
        storage.createCallAnalysis(orgId, analysis),
      ]);
      const earlyTags: string[] = ["empty_transcript"];
      if (!audioArchived) earlyTags.push("audio_missing");
      await storage.updateCall(orgId, callId, {
        status: "completed",
        duration: 0,
        tags: earlyTags,
      });
      await cleanupFile(filePath);
      return;
    }
    logger.info({ callId, step: "3/7", status: transcriptResponse.status }, "Polling complete");

    // Step 4: AI analysis (Gemini or Bedrock/Claude — or fall back to defaults)
    broadcastCallUpdate(callId, "analyzing", { step: 4, totalSteps: 6, label: "Running AI analysis..." }, orgId);
    let aiAnalysis = null;

    // Load custom prompt template for this call category (if configured)
    let promptTemplate: PromptTemplateConfig | undefined = undefined;
    if (callCategory) {
      try {
        const tmpl = await storage.getPromptTemplateByCategory(orgId, callCategory);
        if (tmpl) {
          promptTemplate = {
            evaluationCriteria: tmpl.evaluationCriteria,
            requiredPhrases: tmpl.requiredPhrases,
            scoringWeights: tmpl.scoringWeights,
            additionalInstructions: tmpl.additionalInstructions,
          };
          logger.info({ callId, templateName: tmpl.name }, "Using custom prompt template");
        }
      } catch (tmplError) {
        logger.warn({ callId, err: tmplError }, "Failed to load prompt template (using defaults)");
      }
    }

    // Inject clinical metadata (specialty, format) for clinical encounters
    const clinicalCategories = ["clinical_encounter", "telemedicine", "dental_encounter", "dental_consultation"];
    if (callCategory && clinicalCategories.includes(callCategory)) {
      if (!promptTemplate) promptTemplate = {};
      // Apply user-specified specialty and format from upload form
      if (clinicalSpecialty) {
        promptTemplate.clinicalSpecialty = clinicalSpecialty;
      }
      if (noteFormat) {
        if (!promptTemplate.providerStylePreferences) promptTemplate.providerStylePreferences = {};
        promptTemplate.providerStylePreferences.noteFormat = noteFormat;
      }
    }
    if (callCategory && clinicalCategories.includes(callCategory)) {
      try {
        const org = await storage.getOrganization(orgId);
        const providerPrefs = userId && (org?.settings as any)?.providerStylePreferences?.[userId];
        if (providerPrefs) {
          if (!promptTemplate) promptTemplate = {};
          // Sanitize preferences to prevent prompt injection
          const sanitizedPrefs = sanitizeStylePreferences(providerPrefs);
          promptTemplate.providerStylePreferences = sanitizedPrefs as any;
          if (sanitizedPrefs.defaultSpecialty) {
            promptTemplate.clinicalSpecialty = sanitizedPrefs.defaultSpecialty as string;
          }
          logger.info({ callId, userId }, "Injecting sanitized provider style preferences into clinical prompt");
        }
      } catch (prefErr) {
        logger.warn({ callId, err: prefErr }, "Failed to load provider preferences (continuing without)");
      }
    }

    // Load reference documents for AI context — RAG-enhanced or fallback to full-text
    try {
      const refDocs = await getCachedRefDocs(orgId, callCategory || "");
      const docsWithText = refDocs.filter(d => d.extractedText && d.extractedText.length > 0);

      if (docsWithText.length > 0) {
        if (!promptTemplate) promptTemplate = {};

        // Check if org has RAG enabled (Pro+ tier) and pgvector chunks available
        let useRag = false;
        try {
          const sub = await storage.getSubscription(orgId);
          const tier = (sub?.planTier as PlanTier) || "free";
          const plan = PLAN_DEFINITIONS[tier];
          useRag = plan?.limits?.ragEnabled === true;
        } catch { /* default to non-RAG */ }

        if (useRag && process.env.DATABASE_URL && transcriptResponse.text) {
          // RAG: retrieve semantically relevant chunks instead of full text
          try {
            const { getDatabase } = await import("../db/index");
            const db = getDatabase();
            if (db) {
              const docIds = docsWithText.map(d => d.id);
              // Use transcript summary topics as query for retrieval
              const queryText = transcriptResponse.text.slice(0, 2000);
              const chunks = await searchRelevantChunks(db as any, orgId, queryText, docIds, { topK: 6 });

              if (chunks.length > 0) {
                const ragContext = formatRetrievedContext(chunks);
                promptTemplate.referenceDocuments = [{
                  name: "Retrieved Knowledge Base Context",
                  category: "rag_retrieval",
                  text: ragContext,
                }];
                logger.info({ callId, chunkCount: chunks.length, documentCount: new Set(chunks.map(c => c.documentId)).size }, "RAG: injecting relevant chunks");
              } else {
                // Fallback to full-text if no chunks indexed yet
                promptTemplate.referenceDocuments = docsWithText.map(d => ({
                  name: d.name,
                  category: d.category,
                  text: d.extractedText!,
                }));
                logger.info({ callId, docCount: docsWithText.length }, "No RAG chunks found — falling back to full-text injection");
              }
            }
          } catch (ragError) {
            // Fallback to full-text on RAG failure
            logger.warn({ callId, err: ragError }, "RAG retrieval failed, falling back to full-text");
            promptTemplate.referenceDocuments = docsWithText.map(d => ({
              name: d.name,
              category: d.category,
              text: d.extractedText!,
            }));
          }
        } else {
          // Non-RAG: inject full extracted text (free tier or no DB)
          promptTemplate.referenceDocuments = docsWithText.map(d => ({
            name: d.name,
            category: d.category,
            text: d.extractedText!,
          }));
          logger.info({ callId, docCount: docsWithText.length }, "Injecting reference documents into AI analysis (full-text)");
        }
      }
    } catch (refDocError) {
      logger.warn({ callId, err: refDocError }, "Failed to load reference documents (continuing without)");
    }

    if (aiProvider.isAvailable && transcriptResponse.text) {
      try {
        const transcriptText = transcriptResponse.text;
        const transcriptCharCount = transcriptText.length;
        const estimatedTokens = Math.ceil(transcriptCharCount / 4);
        logger.info({ callId, step: "4/6", provider: aiProvider.name, transcriptChars: transcriptCharCount, estimatedTokens }, "Running AI analysis");

        if (estimatedTokens > 100000) {
          logger.warn({ callId, estimatedTokens }, "Very long transcript. Analysis quality may be reduced for the longest calls");
        }

        aiAnalysis = await withRetry(
          () => aiProvider.analyzeCallTranscript(transcriptText, callId, callCategory, promptTemplate),
          { retries: 2, baseDelay: 2000, label: `AI analysis for ${callId}` }
        );
        logger.info({ callId, step: "4/6" }, "AI analysis complete");
      } catch (aiError) {
        logger.warn({ callId, err: aiError }, "AI analysis failed after retries (continuing with defaults)");
      }
    } else if (!aiProvider.isAvailable) {
      logger.info({ callId, step: "4/6" }, "AI provider not configured, using transcript-based defaults");
    }

    // Warn on clinical calls where AI analysis failed (no clinical note generated)
    if (callCategory && clinicalCategories.includes(callCategory) && !aiAnalysis?.clinical_note) {
      const reason = !aiProvider.isAvailable
        ? "AI provider not configured"
        : aiAnalysis === null
          ? "AI analysis failed"
          : "AI response did not include clinical note";
      logger.warn({ callId, callCategory, reason }, "Clinical encounter processed without clinical note generation");
      // Flag the call so the UI can show a clear warning
      broadcastCallUpdate(callId, "analyzing", {
        step: 4, totalSteps: 6,
        label: "Warning: Clinical note could not be generated",
        warning: `Clinical note was not generated: ${reason}. The call will complete with standard analysis only.`,
      }, orgId);
    }

    // Step 5: Process combined results
    broadcastCallUpdate(callId, "processing", { step: 5, totalSteps: 6, label: "Processing results..." }, orgId);
    logger.info({ callId, step: "5/6" }, "Processing combined transcript and analysis data");
    const { transcript, sentiment, analysis } = assemblyAIService.processTranscriptData(transcriptResponse, aiAnalysis, callId, orgId);

    // Compute confidence score based on transcript quality and analysis completeness
    const transcriptConfidence = transcriptResponse.confidence || 0;
    const wordCount = transcriptResponse.words?.length || 0;
    const callDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
    const hasAiAnalysis = aiAnalysis !== null;

    const wordConfidence = Math.min(wordCount / 50, 1);
    const durationConfidence = callDuration > 30 ? 1 : callDuration / 30;
    const aiConfidence = hasAiAnalysis ? 1 : 0.3;

    const confidenceScore = (
      transcriptConfidence * 0.4 +
      wordConfidence * 0.2 +
      durationConfidence * 0.15 +
      aiConfidence * 0.25
    );

    const transcriptCharCount = (transcriptResponse.text || "").length;
    const confidenceFactors = {
      transcriptConfidence: Math.round(transcriptConfidence * 100) / 100,
      wordCount,
      callDurationSeconds: callDuration,
      transcriptLength: transcriptCharCount,
      aiAnalysisCompleted: hasAiAnalysis,
      overallScore: Math.round(confidenceScore * 100) / 100,
    };

    analysis.confidenceScore = confidenceScore.toFixed(3);
    analysis.confidenceFactors = confidenceFactors;

    if (aiAnalysis?.sub_scores) {
      analysis.subScores = {
        compliance: aiAnalysis.sub_scores.compliance ?? 0,
        customerExperience: aiAnalysis.sub_scores.customer_experience ?? 0,
        communication: aiAnalysis.sub_scores.communication ?? 0,
        resolution: aiAnalysis.sub_scores.resolution ?? 0,
      };
    }

    // Apply score calibration if enabled (normalizes AI scoring distribution)
    if (aiAnalysis?.sub_scores && analysis.performanceScore) {
      try {
        const org = await storage.getOrganization(orgId);
        const calibrated = calibrateAnalysis(
          {
            performance_score: safeFloat(analysis.performanceScore),
            sub_scores: {
              compliance: analysis.subScores?.compliance ?? 0,
              customer_experience: analysis.subScores?.customerExperience ?? 0,
              communication: analysis.subScores?.communication ?? 0,
              resolution: analysis.subScores?.resolution ?? 0,
            },
          },
          org?.settings,
        );
        if (calibrated.calibration_applied) {
          analysis.performanceScore = calibrated.performance_score as any;
          analysis.subScores = {
            compliance: calibrated.sub_scores.compliance,
            customerExperience: calibrated.sub_scores.customer_experience,
            communication: calibrated.sub_scores.communication,
            resolution: calibrated.sub_scores.resolution,
          };
          logger.info({ callId, originalScore: safeFloat(analysis.performanceScore), calibratedScore: calibrated.performance_score }, "Score calibration applied");
        }
      } catch (calErr) {
        logger.warn({ callId, err: calErr }, "Score calibration failed — using raw scores");
      }
    }

    if (aiAnalysis?.detected_agent_name) {
      analysis.detectedAgentName = aiAnalysis.detected_agent_name;
    }

    // Pass through clinical note for clinical encounter categories
    if (aiAnalysis?.clinical_note) {
      const cn_raw = aiAnalysis.clinical_note as any;
      analysis.clinicalNote = {
        format: cn_raw.format || "soap",
        specialty: cn_raw.specialty,
        chiefComplaint: cn_raw.chief_complaint,
        subjective: cn_raw.subjective,
        objective: cn_raw.objective,
        assessment: cn_raw.assessment,
        plan: cn_raw.plan,
        hpiNarrative: cn_raw.hpi_narrative,
        reviewOfSystems: cn_raw.review_of_systems,
        differentialDiagnoses: cn_raw.differential_diagnoses,
        icd10Codes: cn_raw.icd10_codes,
        cptCodes: cn_raw.cpt_codes,
        prescriptions: cn_raw.prescriptions,
        followUp: cn_raw.follow_up,
        documentationCompleteness: cn_raw.documentation_completeness,
        clinicalAccuracy: cn_raw.clinical_accuracy,
        missingSections: cn_raw.missing_sections,
        patientConsentObtained: false,
        providerAttested: false,
        // Behavioral health (DAP/BIRP) fields
        data: cn_raw.data,
        behavior: cn_raw.behavior,
        intervention: cn_raw.intervention,
        response: cn_raw.response,
        // Dental fields
        cdtCodes: cn_raw.cdt_codes,
        toothNumbers: cn_raw.tooth_numbers,
        quadrants: cn_raw.quadrants,
        periodontalFindings: cn_raw.periodontal_findings,
        treatmentPhases: cn_raw.treatment_phases,
      };

      // Validate clinical note completeness (before encryption)
      const cn = analysis.clinicalNote!;
      const validation = validateClinicalNote(cn as any);
      if (!validation.valid) {
        logger.warn({
          callId,
          format: validation.format,
          missingSections: validation.missingSections,
          emptySections: validation.emptySections,
        }, "Clinical note has missing or empty required sections");
        // Merge server-detected missing sections with AI-reported ones
        const aiMissing = cn.missingSections || [];
        cn.missingSections = Array.from(new Set([...aiMissing, ...validation.missingSections, ...validation.emptySections]));
      }
      // Use the more conservative (lower) of AI and server-computed completeness
      // AI may overestimate completeness when sections are empty/shallow
      const aiCompleteness = cn.documentationCompleteness || 0;
      const serverCompleteness = validation.computedCompleteness;
      cn.documentationCompleteness = Math.min(
        aiCompleteness || serverCompleteness,
        serverCompleteness || aiCompleteness,
      ) || serverCompleteness;
      // Store validation warnings for downstream consumers
      if (validation.warnings.length > 0) {
        (cn as any).validationWarnings = validation.warnings;
        logger.info({ callId, warnings: validation.warnings }, "Clinical note validation warnings");
      }

      // Encrypt PHI fields in clinical notes
      if (cn.subjective) cn.subjective = encryptField(cn.subjective);
      if (cn.objective) cn.objective = encryptField(cn.objective);
      if (cn.assessment) cn.assessment = encryptField(cn.assessment);
      if (cn.hpiNarrative) cn.hpiNarrative = encryptField(cn.hpiNarrative);
      if (cn.chiefComplaint) cn.chiefComplaint = encryptField(cn.chiefComplaint);
    }

    // Server-side flag enforcement — ensure consistency regardless of AI output
    const existingFlags: string[] = Array.isArray(analysis.flags) ? [...(analysis.flags as string[])] : [];
    if (confidenceScore < 0.7 && !existingFlags.includes("low_confidence")) {
      existingFlags.push("low_confidence");
    }
    const perfScore = safeFloat(analysis.performanceScore);
    if (perfScore > 0 && perfScore <= 2.0 && !existingFlags.includes("low_score")) {
      existingFlags.push("low_score");
    }
    if (perfScore >= 9.0 && !existingFlags.includes("exceptional_call")) {
      existingFlags.push("exceptional_call");
    }
    analysis.flags = existingFlags;

    logger.info({ callId, step: "5/6", confidencePct: (confidenceScore * 100).toFixed(0) }, "Data processing complete");

    // Step 6: Store results
    broadcastCallUpdate(callId, "saving", { step: 6, totalSteps: 6, label: "Saving results..." }, orgId);
    logger.info({ callId, step: "6/6" }, "Saving analysis results");
    await Promise.all([
      storage.createTranscript(orgId, transcript),
      storage.createSentimentAnalysis(orgId, sentiment),
      storage.createCallAnalysis(orgId, analysis),
    ]);

    // Auto-assign to employee based on detected agent name (if call is unassigned)
    const currentCall = await storage.getCall(orgId, callId);
    let assignedEmployeeId: string | undefined;
    if (!currentCall?.employeeId && aiAnalysis?.detected_agent_name) {
      const detectedName = aiAnalysis.detected_agent_name.toLowerCase().trim();
      if (detectedName) {
        const allEmployees = await storage.getAllEmployees(orgId);
        // Only match active employees — don't assign calls to inactive/terminated staff
        const activeEmployees = allEmployees.filter(emp => !emp.status || emp.status === "Active");
        const matchingEmployees = activeEmployees.filter(emp => {
          const empName = emp.name.toLowerCase().trim();
          const nameParts = empName.split(/\s+/);
          return empName === detectedName ||
            nameParts[0] === detectedName ||
            nameParts[nameParts.length - 1] === detectedName;
        });
        if (matchingEmployees.length === 1) {
          assignedEmployeeId = matchingEmployees[0].id;
          logger.info({ callId, employeeId: matchingEmployees[0].id, detectedName }, "Auto-assigned to employee");
        } else if (matchingEmployees.length > 1) {
          // Prefer exact full-name match over partial first/last name match
          const exactMatch = matchingEmployees.find(emp => emp.name.toLowerCase().trim() === detectedName);
          if (exactMatch) {
            assignedEmployeeId = exactMatch.id;
            logger.info({ callId, employeeId: exactMatch.id, detectedName }, "Auto-assigned to employee (exact match from multiple candidates)");
          } else {
            logger.info({ callId, detectedName, candidates: matchingEmployees.length }, "Ambiguous agent name — multiple employees match, skipping auto-assignment");
          }
        } else {
          logger.info({ callId, detectedName }, "Detected agent name but no matching active employee found");
        }
      }
    }

    // Build tags for the call record
    const callTags: string[] = [];
    if (!audioArchived) callTags.push("audio_missing");

    await storage.updateCall(orgId, callId, {
      status: "completed",
      duration: Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000),
      ...(assignedEmployeeId ? { employeeId: assignedEmployeeId } : {}),
      ...(callTags.length > 0 ? { tags: callTags } : {}),
    });
    logger.info({ callId, step: "6/6", autoAssigned: !!assignedEmployeeId }, "Done. Status is now 'completed'");

    await cleanupFile(filePath);
    broadcastCallUpdate(callId, "completed", { step: 6, totalSteps: 6, label: "Complete" }, orgId);

    // Send webhook notification for flagged calls (non-blocking)
    const finalFlags = (analysis.flags as string[]) || [];
    if (finalFlags.length > 0) {
      notifyFlaggedCall({
        event: "call_flagged",
        callId,
        orgId,
        flags: finalFlags,
        performanceScore: analysis.performanceScore ? safeFloat(analysis.performanceScore) : undefined,
        agentName: analysis.detectedAgentName || undefined,
        fileName: originalName,
        summary: typeof analysis.summary === "string" ? analysis.summary : undefined,
        timestamp: new Date().toISOString(),
      }).catch(() => {});
    }

    logger.info({ callId }, "Processing finished successfully");

    // Auto-generate coaching recommendations (non-blocking)
    onCallAnalysisComplete(orgId, callId, assignedEmployeeId || undefined).catch(() => {});

    trackUsage({ orgId, eventType: "transcription", quantity: 1, metadata: { callId } });
    if (aiAnalysis) {
      trackUsage({ orgId, eventType: "ai_analysis", quantity: 1, metadata: { callId, model: aiProvider.name } });
    }

    // Record detailed spend/cost estimate
    try {
      const audioDuration = Math.floor((transcriptResponse.words?.[transcriptResponse.words.length - 1]?.end || 0) / 1000);
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      const estimatedInputTokens = Math.ceil((transcriptResponse.text || "").length / 4) + 500;
      const estimatedOutputTokens = 800;
      const bedrockModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";
      const bedrockCost = aiAnalysis ? estimateBedrockCost(bedrockModel, estimatedInputTokens, estimatedOutputTokens) : 0;

      const spendRecord: UsageRecord = {
        id: randomUUID(),
        orgId,
        callId,
        type: "call",
        timestamp: new Date().toISOString(),
        user: "system",
        services: {
          assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
          ...(aiAnalysis ? {
            bedrock: {
              model: bedrockModel,
              estimatedInputTokens,
              estimatedOutputTokens,
              estimatedCost: Math.round(bedrockCost * 10000) / 10000,
            },
          } : {}),
        },
        totalEstimatedCost: Math.round((assemblyaiCost + bedrockCost) * 10000) / 10000,
      };
      await storage.createUsageRecord(orgId, spendRecord);
    } catch (spendErr) {
      logger.warn({ callId, err: spendErr }, "Failed to record spend (non-blocking)");
    }

  } catch (error) {
    logger.error({ callId, err: error }, "A critical error occurred during audio processing");
    await storage.updateCall(orgId, callId, { status: "failed" });
    broadcastCallUpdate(callId, "failed", { label: "Processing failed" }, orgId);
    await cleanupFile(filePath);
  }
}

/** @deprecated Use decryptClinicalNotePhi from phi-encryption.ts */
const decryptClinicalNote = decryptClinicalNotePhi;

export function registerCallRoutes(app: Express): void {

  app.get("/api/calls", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { status, sentiment, employee, limit, offset } = req.query;
      const parsedLimit = limit ? Math.min(Math.max(1, parseInt(limit as string, 10) || 100), 500) : undefined;
      const parsedOffset = Math.max(0, parseInt(offset as string, 10) || 0);

      const calls = await storage.getCallsWithDetails(req.orgId!, {
        status: status as string,
        sentiment: sentiment as string,
        employee: employee as string,
        limit: parsedLimit,
        offset: parsedOffset,
      });

      if (parsedLimit && parsedLimit > 0) {
        res.json({ data: calls, total: calls.length, limit: parsedLimit, offset: parsedOffset });
      } else {
        // Backwards compatible — return raw array when no limit specified
        res.json(calls);
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to get calls" });
    }
  });

  app.get("/api/calls/:id", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: "view_call_details",
        resourceType: "call",
        resourceId: req.params.id,
      });

      const [employee, transcript, sentiment, rawAnalysis] = await Promise.all([
        call.employeeId ? storage.getEmployee(req.orgId!, call.employeeId) : undefined,
        storage.getTranscript(req.orgId!, call.id),
        storage.getSentimentAnalysis(req.orgId!, call.id),
        storage.getCallAnalysis(req.orgId!, call.id),
      ]);

      const analysis = normalizeAnalysis(rawAnalysis);
      decryptClinicalNote(analysis as Record<string, unknown> | null);

      res.json({
        ...call,
        employee,
        transcript,
        sentiment,
        analysis
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get call" });
    }
  });

  app.post("/api/calls/upload", requireAuth, injectOrgContext, requireActiveSubscription(), enforceQuota("transcription"), upload.single('audioFile'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { employeeId, callCategory, clinicalSpecialty, noteFormat } = req.body;

      // Validate callCategory against allowed values
      const validCategories = CALL_CATEGORIES.map(c => c.value);
      if (callCategory && !validCategories.includes(callCategory)) {
        await cleanupFile(req.file.path);
        res.status(400).json({ message: `Invalid call category. Must be one of: ${validCategories.join(", ")}` });
        return;
      }

      if (employeeId) {
        const employee = await storage.getEmployee(req.orgId!, employeeId);
        if (!employee) {
          await cleanupFile(req.file.path);
          res.status(404).json({ message: "Employee not found" });
          return;
        }
      }

      const audioBuffer = fs.readFileSync(req.file.path);
      const fileHash = createHash("sha256").update(audioBuffer).digest("hex");
      const duplicate = await storage.getCallByFileHash(req.orgId!, fileHash);
      if (duplicate) {
        await cleanupFile(req.file.path);
        res.status(200).json(duplicate);
        return;
      }

      const call = await storage.createCall(req.orgId!, {
        orgId: req.orgId!,
        employeeId: employeeId || undefined,
        fileName: req.file.originalname,
        filePath: req.file.path,
        fileHash,
        status: "processing",
        callCategory: callCategory || undefined,
      });
      const originalName = req.file.originalname;
      const mimeType = req.file.mimetype || "audio/mpeg";
      const orgId = req.orgId!;
      const uploadUserId = req.user?.id;
      processAudioFile(orgId, call.id, req.file.path, audioBuffer, originalName, mimeType, callCategory, uploadUserId, clinicalSpecialty, noteFormat)
        .catch(async (error) => {
          logger.error({ callId: call.id, err: error }, "Failed to process call");
          try {
            await storage.updateCall(orgId, call.id, { status: "failed" });
          } catch (updateErr) {
            logger.error({ callId: call.id, err: updateErr }, "Failed to mark call as failed");
          }
        });

      res.status(201).json(call);
    } catch (error) {
      logger.error({ err: error }, "Error during file upload");
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to upload call" });
    }
  });

  app.get("/api/calls/:id/audio", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      logPhiAccess({
        ...auditContext(req),
        event: req.query.download === "true" ? "download_audio" : "stream_audio",
        resourceType: "audio",
        resourceId: req.params.id,
      });

      const audioFiles = await storage.getAudioFiles(req.orgId!, req.params.id);
      if (!audioFiles || audioFiles.length === 0) {
        res.status(404).json({ message: "Audio file not found in archive" });
        return;
      }

      const audioBuffer = await storage.downloadAudio(req.orgId!, audioFiles[0]);
      if (!audioBuffer) {
        res.status(404).json({ message: "Audio file could not be retrieved" });
        return;
      }

      const ext = path.extname(audioFiles[0]).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.mp4': 'audio/mp4',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
      };
      const contentType = mimeTypes[ext] || 'audio/mpeg';

      if (req.query.download === 'true') {
        const rawName = call.fileName || `call-${req.params.id}${ext}`;
        const safeName = path.basename(rawName).replace(/[^\w.\-() ]/g, "_");
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', audioBuffer.length.toString());
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.send(audioBuffer);
    } catch (error) {
      logger.error({ err: error }, "Failed to stream audio");
      res.status(500).json({ message: "Failed to stream audio" });
    }
  });

  app.get("/api/calls/:id/transcript", requireAuth, injectOrgContext, async (req, res) => {
    try {
      logPhiAccess({
        ...auditContext(req),
        event: "view_transcript",
        resourceType: "transcript",
        resourceId: req.params.id,
      });

      const transcript = await storage.getTranscript(req.orgId!, req.params.id);
      if (!transcript) {
        res.status(404).json({ message: "Transcript not found" });
        return;
      }
      res.json(transcript);
    } catch (error) {
      res.status(500).json({ message: "Failed to get transcript" });
    }
  });

  app.get("/api/calls/:id/sentiment", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const sentiment = await storage.getSentimentAnalysis(req.orgId!, req.params.id);
      if (!sentiment) {
        res.status(404).json({ message: "Sentiment analysis not found" });
        return;
      }
      logPhiAccess({
        ...auditContext(req),
        event: "view_sentiment_analysis",
        resourceType: "sentiment",
        resourceId: req.params.id,
      });
      res.json(sentiment);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment analysis" });
    }
  });

  app.get("/api/calls/:id/analysis", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const analysis = await storage.getCallAnalysis(req.orgId!, req.params.id);
      if (!analysis) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }
      decryptClinicalNote(analysis as Record<string, unknown>);
      logPhiAccess({
        ...auditContext(req),
        event: "view_call_analysis",
        resourceType: "analysis",
        resourceId: req.params.id,
      });
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ message: "Failed to get call analysis" });
    }
  });

  app.patch("/api/calls/:id/analysis", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;
      const { updates, reason } = req.body;

      logPhiAccess({
        ...auditContext(req),
        event: "edit_call_analysis",
        resourceType: "analysis",
        resourceId: callId,
        detail: `reason: ${reason}; fields: ${updates ? Object.keys(updates).join(",") : "none"}`,
      });

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ message: "A reason for the manual edit is required." });
        return;
      }

      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        res.status(400).json({ message: "Updates must be a non-empty object." });
        return;
      }

      const ALLOWED_FIELDS = new Set([
        "summary", "performanceScore", "topics", "actionItems",
        "feedback", "flags", "sentiment", "sentimentScore",
      ]);
      const disallowed = Object.keys(updates).filter(k => !ALLOWED_FIELDS.has(k));
      if (disallowed.length > 0) {
        res.status(400).json({ message: `Cannot edit fields: ${disallowed.join(", ")}` });
        return;
      }

      const existing = await storage.getCallAnalysis(req.orgId!, callId);
      if (!existing) {
        res.status(404).json({ message: "Call analysis not found" });
        return;
      }

      const user = req.user;
      const editedBy = user?.name || user?.username || "Unknown User";

      const previousEdits = Array.isArray(existing.manualEdits) ? existing.manualEdits : [];
      const editRecord = {
        editedBy,
        editedAt: new Date().toISOString(),
        reason: reason.trim(),
        fieldsChanged: Object.keys(updates),
        previousValues: {} as Record<string, any>,
      };

      for (const key of Object.keys(updates)) {
        editRecord.previousValues[key] = (existing as any)[key];
      }

      const updatedAnalysis = {
        ...existing,
        ...updates,
        manualEdits: [...previousEdits, editRecord],
      };

      await storage.createCallAnalysis(req.orgId!, updatedAnalysis);

      logger.info({ callId, editedBy, reason, fields: editRecord.fieldsChanged }, "Manual edit applied to call analysis");
      res.json(updatedAnalysis);
    } catch (error) {
      logger.error({ err: error }, "Failed to update call analysis");
      res.status(500).json({ message: "Failed to update call analysis" });
    }
  });

  app.patch("/api/calls/:id/assign", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { employeeId } = req.body;
      if (!employeeId) {
        res.status(400).json({ message: "employeeId is required" });
        return;
      }

      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }

      const employee = await storage.getEmployee(req.orgId!, employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const updated = await storage.updateCall(req.orgId!, req.params.id, { employeeId });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign call" });
    }
  });

  app.patch("/api/calls/:id/tags", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { tags } = req.body;
      if (!Array.isArray(tags)) {
        res.status(400).json({ message: "tags must be an array" });
        return;
      }
      const call = await storage.getCall(req.orgId!, req.params.id);
      if (!call) {
        res.status(404).json({ message: "Call not found" });
        return;
      }
      const updated = await storage.updateCall(req.orgId!, req.params.id, { tags });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update tags" });
    }
  });

  app.delete("/api/calls/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const callId = req.params.id;

      logPhiAccess({
        ...auditContext(req),
        event: "delete_call",
        resourceType: "call",
        resourceId: callId,
      });

      await storage.deleteCall(req.orgId!, callId);

      logger.info({ callId }, "Successfully deleted call");
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, "Failed to delete call");
      res.status(500).json({ message: "Failed to delete call" });
    }
  });
}
