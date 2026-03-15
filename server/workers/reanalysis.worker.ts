/**
 * Bulk reanalysis worker — re-analyzes calls with updated prompt templates.
 *
 * Processes jobs from the "bulk-reanalysis" BullMQ queue.
 * Each job contains { orgId, callIds?, requestedBy } and re-runs
 * AI analysis on the specified (or all completed) calls.
 */
import { Worker, type Job } from "bullmq";
import type { BulkReanalysisJob } from "../services/queue";
import { logger } from "../services/logger";

export function createReanalysisWorker(
  connection: import("bullmq").ConnectionOptions,
  getStorage: () => import("../storage/types").IStorage,
  getAiProvider: () => { isAvailable: boolean; name: string; analyzeCallTranscript: (...args: any[]) => Promise<any> },
  getAssemblyAIService: () => { processTranscriptData: (...args: any[]) => any },
): Worker<BulkReanalysisJob> {
  const worker = new Worker<BulkReanalysisJob>(
    "bulk-reanalysis",
    async (job: Job<BulkReanalysisJob>) => {
      const { orgId, callIds, requestedBy } = job.data;
      const storage = getStorage();
      const aiProvider = getAiProvider();
      const assemblyAIService = getAssemblyAIService();

      if (!aiProvider.isAvailable) {
        logger.warn({ orgId, jobId: job.id }, "Reanalysis worker: AI provider not available");
        return { succeeded: 0, failed: 0, skipped: 0, reason: "AI provider unavailable" };
      }

      // Get target calls
      const allCalls = await storage.getCallsWithDetails(orgId, { status: "completed" });
      const targetCalls = callIds?.length
        ? allCalls.filter(c => callIds.includes(c.id))
        : allCalls;

      const callsWithTranscripts = targetCalls.filter(c => c.transcript?.text);

      let succeeded = 0;
      let failed = 0;

      // Cache prompt templates by category to avoid repeated DB lookups
      const templateCache = new Map<string, any>();

      for (const call of callsWithTranscripts) {
        try {
          const transcriptText = call.transcript!.text!;

          // Load prompt template (cached per category within this job)
          let promptTemplate = undefined;
          if (call.callCategory) {
            if (templateCache.has(call.callCategory)) {
              promptTemplate = templateCache.get(call.callCategory);
            } else {
              const tmpl = await storage.getPromptTemplateByCategory(orgId, call.callCategory);
              if (tmpl) {
                promptTemplate = {
                  evaluationCriteria: tmpl.evaluationCriteria,
                  requiredPhrases: tmpl.requiredPhrases,
                  scoringWeights: tmpl.scoringWeights,
                  additionalInstructions: tmpl.additionalInstructions,
                };
              }
              templateCache.set(call.callCategory, promptTemplate);
            }
          }

          const aiAnalysis = await aiProvider.analyzeCallTranscript(
            transcriptText, call.id, call.callCategory, promptTemplate,
          );

          const { analysis } = assemblyAIService.processTranscriptData(
            { id: "", status: "completed", text: transcriptText, words: call.transcript?.words },
            aiAnalysis,
            call.id,
          );

          if (aiAnalysis.sub_scores) {
            analysis.subScores = {
              compliance: aiAnalysis.sub_scores.compliance ?? 0,
              customerExperience: aiAnalysis.sub_scores.customer_experience ?? 0,
              communication: aiAnalysis.sub_scores.communication ?? 0,
              resolution: aiAnalysis.sub_scores.resolution ?? 0,
            };
          }
          if (aiAnalysis.detected_agent_name) {
            analysis.detectedAgentName = aiAnalysis.detected_agent_name;
          }

          await storage.createCallAnalysis(orgId, { ...analysis, callId: call.id });
          succeeded++;

          // Update progress
          await job.updateProgress(Math.round(((succeeded + failed) / callsWithTranscripts.length) * 100));
        } catch (error) {
          logger.error({ callId: call.id, err: error }, "Reanalysis worker: call failed");
          failed++;
        }
      }

      logger.info(
        { orgId, succeeded, failed, total: callsWithTranscripts.length, requestedBy },
        "Reanalysis worker: complete",
      );

      return { succeeded, failed, total: callsWithTranscripts.length };
    },
    {
      connection,
      concurrency: parseInt(process.env.REANALYSIS_CONCURRENCY || "3", 10), // Parallel Bedrock calls (configurable)
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Reanalysis worker: job failed");
  });

  return worker;
}
