import type { Express } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { assemblyAIService } from "../services/assemblyai";
import { BedrockProvider } from "../services/bedrock";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { broadcastCallUpdate } from "../services/websocket";
import { trackUsage } from "../services/queue";
import { upload } from "./helpers";
import { logger } from "../services/logger";
import { requireActiveSubscription, requirePlanFeature } from "./billing";
import { BEDROCK_MODEL_PRESETS, CALL_CATEGORIES, type UsageRecord } from "@shared/schema";

// --- Cost estimation functions ---

/** Estimate Bedrock cost based on model and token counts. */
function estimateBedrockCost(model: string, inputTokens: number, outputTokens: number): number {
  // Approximate pricing per 1K tokens (input, output) — updated as of 2026
  const pricing: Record<string, [number, number]> = {
    "us.anthropic.claude-sonnet-4-6": [0.003, 0.015],
    "us.anthropic.claude-sonnet-4-20250514": [0.003, 0.015],
    "us.anthropic.claude-haiku-4-5-20251001": [0.001, 0.005],
    "anthropic.claude-3-haiku-20240307": [0.00025, 0.00125],
    "anthropic.claude-3-5-sonnet-20241022": [0.003, 0.015],
  };
  const [inputRate, outputRate] = pricing[model] || [0.003, 0.015];
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

/** Estimate AssemblyAI cost: base $0.15/hr + sentiment $0.02/hr = $0.17/hr = ~$0.0000472/sec */
function estimateAssemblyAICost(durationSeconds: number): number {
  return durationSeconds * 0.0000472;
}

export { estimateBedrockCost, estimateAssemblyAICost };

async function cleanupFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* non-blocking */ }
}

export function registerABTestRoutes(app: Express): void {

  // List all A/B tests
  app.get("/api/ab-tests", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const tests = await storage.getAllABTests(req.orgId!);
      res.json(tests);
    } catch (error) {
      logger.error({ err: error }, "Error fetching A/B tests");
      res.status(500).json({ message: "Failed to fetch A/B tests" });
    }
  });

  // Get a single A/B test
  app.get("/api/ab-tests/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const test = await storage.getABTest(req.orgId!, req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      res.json(test);
    } catch (error) {
      logger.error({ err: error }, "Error fetching A/B test");
      res.status(500).json({ message: "Failed to fetch A/B test" });
    }
  });

  // Upload audio for A/B model comparison
  app.post("/api/ab-tests/upload", requireAuth, requireRole("admin"), injectOrgContext, requireActiveSubscription(), requirePlanFeature("customPromptTemplates", "A/B model testing requires a Pro or Enterprise plan"), upload.single("audioFile"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No audio file provided" });
        return;
      }

      const { testModel } = req.body;
      const validModels = BEDROCK_MODEL_PRESETS.map(m => m.value) as string[];
      if (!testModel || !validModels.includes(testModel)) {
        await cleanupFile(req.file.path);
        res.status(400).json({ message: `Invalid model. Must be one of: ${validModels.join(", ")}` });
        return;
      }
      const abValidCategories = CALL_CATEGORIES.map(c => c.value) as string[];
      const callCategory = abValidCategories.includes(req.body.callCategory) ? req.body.callCategory : undefined;

      const user = req.user as any;
      const orgId = req.orgId!;
      const baselineModel = process.env.BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-6";

      const abTest = await storage.createABTest(orgId, {
        orgId,
        fileName: req.file.originalname,
        callCategory: callCategory || undefined,
        baselineModel,
        testModel,
        status: "processing",
        createdBy: user?.username || "admin",
      });

      const filePath = req.file.path;

      // Async processing — non-blocking
      processABTest(orgId, abTest.id, filePath, callCategory, user?.username || "admin").catch(async (error) => {
        logger.error({ testId: abTest.id, err: error }, "A/B test processing failed");
        try {
          await storage.updateABTest(orgId, abTest.id, { status: "failed" });
        } catch { /* ignore */ }
      });

      res.status(201).json(abTest);
    } catch (error) {
      logger.error({ err: error }, "Error starting A/B test");
      if (req.file?.path) await cleanupFile(req.file.path);
      res.status(500).json({ message: "Failed to start A/B test" });
    }
  });

  // Delete an A/B test
  app.delete("/api/ab-tests/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const test = await storage.getABTest(req.orgId!, req.params.id);
      if (!test) {
        res.status(404).json({ message: "A/B test not found" });
        return;
      }
      await storage.deleteABTest(req.orgId!, req.params.id);
      res.json({ message: "A/B test deleted" });
    } catch (error) {
      logger.error({ err: error }, "Error deleting A/B test");
      res.status(500).json({ message: "Failed to delete A/B test" });
    }
  });
}

// --- A/B test processing pipeline ---
async function processABTest(orgId: string, testId: string, filePath: string, callCategory?: string, userName?: string) {
  logger.info({ testId }, "Starting A/B model comparison");
  try {
    const abTest = await storage.getABTest(orgId, testId);
    if (!abTest) throw new Error("A/B test record not found");

    // Read file
    const audioBuffer = await fs.promises.readFile(filePath);

    // Step 1: Upload to AssemblyAI and transcribe
    logger.info({ testId, step: "1/2" }, "Uploading to AssemblyAI");
    const audioUrl = await assemblyAIService.uploadAudioFile(audioBuffer, path.basename(filePath));
    const transcriptId = await assemblyAIService.transcribeAudio(audioUrl);
    const transcriptResponse = await assemblyAIService.pollTranscript(transcriptId);

    if (!transcriptResponse || transcriptResponse.status !== "completed") {
      throw new Error(`Transcription failed. Status: ${transcriptResponse?.status}`);
    }

    const transcriptText = transcriptResponse.text || "";
    await storage.updateABTest(orgId, testId, { transcriptText, status: "analyzing" });
    logger.info({ testId, chars: transcriptText.length }, "Transcription complete");

    // Load prompt template if applicable
    let promptTemplate = undefined;
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
        }
      } catch (e) {
        logger.warn({ testId, err: e }, "Failed to load prompt template");
      }
    }

    // Step 2: Run both models in parallel
    logger.info({ testId, step: "2/2" }, "Running analysis with both models");
    const baselineProvider = BedrockProvider.createWithModel(abTest.baselineModel);
    const testProvider = BedrockProvider.createWithModel(abTest.testModel);

    const [baselineResult, testResult] = await Promise.allSettled([
      (async () => {
        const start = Date.now();
        const analysis = await baselineProvider.analyzeCallTranscript(transcriptText, `ab-baseline-${testId}`, callCategory, promptTemplate);
        return { analysis, latencyMs: Date.now() - start };
      })(),
      (async () => {
        const start = Date.now();
        const analysis = await testProvider.analyzeCallTranscript(transcriptText, `ab-test-${testId}`, callCategory, promptTemplate);
        return { analysis, latencyMs: Date.now() - start };
      })(),
    ]);

    const updates: Record<string, any> = { status: "completed" };

    if (baselineResult.status === "fulfilled") {
      updates.baselineAnalysis = baselineResult.value.analysis;
      updates.baselineLatencyMs = baselineResult.value.latencyMs;
    } else {
      updates.baselineAnalysis = { error: (baselineResult as PromiseRejectedResult).reason?.message || "Analysis failed" };
    }

    if (testResult.status === "fulfilled") {
      updates.testAnalysis = testResult.value.analysis;
      updates.testLatencyMs = testResult.value.latencyMs;
    } else {
      updates.testAnalysis = { error: (testResult as PromiseRejectedResult).reason?.message || "Analysis failed" };
    }

    if (baselineResult.status === "rejected" && testResult.status === "rejected") {
      updates.status = "failed";
    }

    await storage.updateABTest(orgId, testId, updates);

    // Track usage/cost
    try {
      const audioDuration = transcriptText.length > 0
        ? Math.max(30, Math.ceil(transcriptText.length / 20))
        : 60;
      const assemblyaiCost = estimateAssemblyAICost(audioDuration);
      const estimatedInputTokens = Math.ceil(transcriptText.length / 4) + 500;
      const estimatedOutputTokens = 800;

      let baselineCost = 0;
      let testCost = 0;
      const services: UsageRecord["services"] = {
        assemblyai: { durationSeconds: audioDuration, estimatedCost: Math.round(assemblyaiCost * 10000) / 10000 },
      };

      if (baselineResult.status === "fulfilled") {
        baselineCost = estimateBedrockCost(abTest.baselineModel, estimatedInputTokens, estimatedOutputTokens);
        services.bedrock = {
          model: abTest.baselineModel,
          estimatedInputTokens,
          estimatedOutputTokens,
          estimatedCost: Math.round(baselineCost * 10000) / 10000,
          latencyMs: baselineResult.value.latencyMs,
        };
      }
      if (testResult.status === "fulfilled") {
        testCost = estimateBedrockCost(abTest.testModel, estimatedInputTokens, estimatedOutputTokens);
        services.bedrockSecondary = {
          model: abTest.testModel,
          estimatedInputTokens,
          estimatedOutputTokens,
          estimatedCost: Math.round(testCost * 10000) / 10000,
          latencyMs: testResult.value.latencyMs,
        };
      }

      const usageRecord: UsageRecord = {
        id: randomUUID(),
        orgId,
        callId: testId,
        type: "ab-test",
        timestamp: new Date().toISOString(),
        user: userName || "admin",
        services,
        totalEstimatedCost: Math.round((assemblyaiCost + baselineCost + testCost) * 10000) / 10000,
      };
      await storage.createUsageRecord(orgId, usageRecord);
    } catch (usageErr) {
      logger.warn({ testId, err: usageErr }, "Failed to record A/B test usage (non-blocking)");
    }

    // Also track in standard usage events for quota enforcement
    trackUsage({ orgId, eventType: "transcription", quantity: 1, metadata: { callId: testId, type: "ab-test" } });
    trackUsage({ orgId, eventType: "ai_analysis", quantity: 2, metadata: { callId: testId, type: "ab-test" } });

    await cleanupFile(filePath);
    broadcastCallUpdate(testId, "ab-test-completed", { label: "A/B test complete" }, orgId);
    logger.info({ testId }, "A/B comparison complete");

  } catch (error) {
    logger.error({ testId, err: error }, "A/B test processing error");
    await storage.updateABTest(orgId, testId, { status: "failed" });
    await cleanupFile(filePath);
  }
}
