/**
 * Email channel routes — submit, analyze, and manage email communications.
 *
 * Emails are stored as Call entities with channel="email". This means they
 * automatically work with all existing features: dashboards, coaching,
 * gamification, revenue tracking, calibration, etc.
 *
 * Key difference from voice calls: emails skip AssemblyAI transcription
 * entirely, so the cost is just the Bedrock AI analysis (~$0.01-0.02/email).
 */
import type { Express } from "express";
import { randomUUID } from "crypto";
import { storage, normalizeAnalysis } from "../storage";
import { aiProvider } from "../services/ai-factory";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { broadcastCallUpdate } from "../services/websocket";
import { logPhiAccess, auditContext } from "../services/audit-log";
import { notifyFlaggedCall } from "../services/notifications";
import { onCallAnalysisComplete } from "../services/proactive-alerts";
import { trackUsage } from "../services/queue";
import { withRetry } from "./helpers";
import { enforceQuota, requireActiveSubscription } from "./billing";
import { logger } from "../services/logger";
import { searchRelevantChunks, formatRetrievedContext } from "../services/rag";
import { PLAN_DEFINITIONS, type PlanTier, type UsageRecord } from "@shared/schema";
import { estimateBedrockCost } from "./ab-testing";
import { buildEmailSystemPrompt, parseJsonResponse, type PromptTemplateConfig } from "../services/ai-provider";
import { errorResponse, ERROR_CODES } from "../services/error-codes";
import type { Request, Response } from "express";

export function registerEmailRoutes(app: Express): void {

  /**
   * POST /api/emails/submit
   * Submit an email for AI quality analysis.
   * Creates a Call record with channel="email" and runs AI analysis directly
   * (no transcription step needed).
   */
  app.post("/api/emails/submit",
    requireAuth,
    requireActiveSubscription,
    enforceQuota,
    async (req: Request, res: Response) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const {
        subject,
        from: emailFrom,
        to: emailTo,
        cc: emailCc,
        body,
        bodyHtml,
        category,
        threadId,
        messageId,
        receivedAt,
        employeeId,
      } = req.body;

      // Validate required fields
      if (!body || typeof body !== "string" || body.trim().length < 5) {
        return res.status(400).json({ message: "Email body is required (minimum 5 characters)" });
      }
      if (!subject || typeof subject !== "string") {
        return res.status(400).json({ message: "Email subject is required" });
      }

      try {
        const callId = randomUUID();
        const userId = (req.user as any)?.id;
        const userName = (req.user as any)?.name || (req.user as any)?.username || "unknown";

        // Determine email category
        const emailCategory = category && typeof category === "string" && category.startsWith("email_")
          ? category
          : "email_general";

        // Create the call record with channel="email"
        const call = await storage.createCall(orgId, {
          orgId,
          status: "processing",
          callCategory: emailCategory,
          channel: "email",
          emailSubject: subject,
          emailFrom: emailFrom || undefined,
          emailTo: emailTo || undefined,
          emailCc: emailCc || undefined,
          emailBody: body,
          emailBodyHtml: bodyHtml || undefined,
          emailMessageId: messageId || undefined,
          emailThreadId: threadId || undefined,
          emailReceivedAt: receivedAt || new Date().toISOString(),
          employeeId: employeeId || undefined,
          fileName: `email-${subject.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}`,
          tags: ["email"],
        });

        broadcastCallUpdate(call.id, "processing", { step: 1, totalSteps: 3, label: "Analyzing email..." }, orgId);

        // Process email analysis asynchronously
        processEmailAnalysis(orgId, call.id, subject, body, emailCategory, userId, userName).catch(err => {
          logger.error({ err, callId: call.id }, "Email analysis failed");
        });

        res.status(201).json({
          id: call.id,
          status: "processing",
          channel: "email",
          message: "Email submitted for analysis",
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to submit email");
        res.status(500).json({ message: "Failed to submit email for analysis" });
      }
    }
  );

  /**
   * POST /api/emails/bulk-submit
   * Submit multiple emails at once (e.g., from inbox integration).
   */
  app.post("/api/emails/bulk-submit",
    requireAuth,
    requireRole("manager"),
    requireActiveSubscription,
    async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { emails } = req.body;
      if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ message: "emails array is required" });
      }
      if (emails.length > 50) {
        return res.status(400).json({ message: "Maximum 50 emails per batch" });
      }

      const userId = (req.user as any)?.id;
      const userName = (req.user as any)?.name || (req.user as any)?.username || "unknown";
      const results: Array<{ id: string; subject: string; status: string }> = [];

      for (const email of emails) {
        if (!email.body || !email.subject) {
          results.push({ id: "", subject: email.subject || "unknown", status: "skipped_missing_fields" });
          continue;
        }

        try {
          const emailCategory = email.category && email.category.startsWith("email_")
            ? email.category
            : "email_general";

          const call = await storage.createCall(orgId, {
            orgId,
            status: "processing",
            callCategory: emailCategory,
            channel: "email",
            emailSubject: email.subject,
            emailFrom: email.from || undefined,
            emailTo: email.to || undefined,
            emailBody: email.body,
            emailBodyHtml: email.bodyHtml || undefined,
            emailMessageId: email.messageId || undefined,
            emailThreadId: email.threadId || undefined,
            emailReceivedAt: email.receivedAt || new Date().toISOString(),
            employeeId: email.employeeId || undefined,
            fileName: `email-${email.subject.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}`,
            tags: ["email"],
          });

          // Fire-and-forget analysis
          processEmailAnalysis(orgId, call.id, email.subject, email.body, emailCategory, userId, userName).catch(err => {
            logger.error({ err, callId: call.id }, "Bulk email analysis failed");
          });

          results.push({ id: call.id, subject: email.subject, status: "processing" });
        } catch (error) {
          results.push({ id: "", subject: email.subject, status: "failed" });
        }
      }

      res.json({ submitted: results.filter(r => r.status === "processing").length, results });
    }
  );

  /**
   * GET /api/emails
   * List all email interactions for the org (convenience endpoint, filters by channel).
   */
  app.get("/api/emails",
    requireAuth,
    async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      try {
        const allCalls = await storage.getCallsWithDetails(orgId, {
          limit: parseInt(req.query.limit as string) || 100,
          offset: parseInt(req.query.offset as string) || 0,
        });

        // Filter to email channel only
        const emails = allCalls.filter(c => c.channel === "email");

        res.json(emails);
      } catch (error) {
        logger.error({ err: error }, "Failed to list emails");
        res.status(500).json({ message: "Failed to list emails" });
      }
    }
  );

  /**
   * GET /api/emails/threads
   * Get email conversations grouped by thread ID.
   */
  app.get("/api/emails/threads",
    requireAuth,
    async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      try {
        const allCalls = await storage.getAllCalls(orgId);
        const emailCalls = allCalls.filter(c => c.channel === "email" && c.emailThreadId);

        // Group by thread ID
        const threads = new Map<string, typeof emailCalls>();
        for (const email of emailCalls) {
          const tid = email.emailThreadId!;
          if (!threads.has(tid)) threads.set(tid, []);
          threads.get(tid)!.push(email);
        }

        const result = Array.from(threads.entries()).map(([threadId, messages]) => ({
          threadId,
          messageCount: messages.length,
          latestSubject: messages.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""))[0]?.emailSubject,
          latestDate: messages[0]?.uploadedAt,
          messages: messages.sort((a, b) => (a.uploadedAt || "").localeCompare(b.uploadedAt || "")),
        }));

        res.json(result.sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || "")));
      } catch (error) {
        logger.error({ err: error }, "Failed to list email threads");
        res.status(500).json({ message: "Failed to list email threads" });
      }
    }
  );

  /**
   * GET /api/emails/stats
   * Email channel analytics: volume, avg scores, category breakdown.
   */
  app.get("/api/emails/stats",
    requireAuth,
    async (req, res) => {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      try {
        const allCalls = await storage.getCallsWithDetails(orgId);
        const emails = allCalls.filter(c => c.channel === "email");

        const completed = emails.filter(e => e.status === "completed");
        const scores = completed
          .map(e => parseFloat(e.analysis?.performanceScore || "0"))
          .filter(s => s > 0);

        const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

        // Category breakdown
        const byCategory: Record<string, number> = {};
        for (const e of emails) {
          const cat = e.callCategory || "email_general";
          byCategory[cat] = (byCategory[cat] || 0) + 1;
        }

        // Sentiment breakdown
        const sentiments = { positive: 0, neutral: 0, negative: 0 };
        for (const e of completed) {
          const sent = e.sentiment?.overallSentiment as keyof typeof sentiments;
          if (sent && sentiments[sent] !== undefined) sentiments[sent]++;
        }

        // Thread count
        const threadIds = new Set(emails.filter(e => e.emailThreadId).map(e => e.emailThreadId));

        res.json({
          totalEmails: emails.length,
          completed: completed.length,
          processing: emails.filter(e => e.status === "processing").length,
          failed: emails.filter(e => e.status === "failed").length,
          avgPerformanceScore: Math.round(avgScore * 10) / 10,
          sentimentDistribution: sentiments,
          categoryBreakdown: byCategory,
          threadCount: threadIds.size,
        });
      } catch (error) {
        logger.error({ err: error }, "Failed to get email stats");
        res.status(500).json({ message: "Failed to get email stats" });
      }
    }
  );
}

/**
 * Process an email through AI analysis.
 * This is the email equivalent of processAudioFile() — but much simpler
 * because we skip transcription entirely.
 */
async function processEmailAnalysis(
  orgId: string,
  callId: string,
  subject: string,
  body: string,
  emailCategory: string,
  userId?: string,
  userName?: string,
) {
  logger.info({ callId, channel: "email" }, "Starting email analysis");

  try {
    // Step 1: Create transcript from email text
    // The "transcript" for an email is the email body itself
    const transcriptText = `Subject: ${subject}\n\n${body}`;

    await storage.createTranscript(orgId, {
      orgId,
      callId,
      text: transcriptText,
      confidence: "1.00", // Email text has perfect "transcription" confidence
    });

    broadcastCallUpdate(callId, "analyzing", { step: 2, totalSteps: 3, label: "Running AI analysis..." }, orgId);

    // Step 2: Load prompt template and reference docs
    let promptTemplate: PromptTemplateConfig | undefined = undefined;
    try {
      const tmpl = await storage.getPromptTemplateByCategory(orgId, emailCategory);
      if (tmpl) {
        promptTemplate = {
          evaluationCriteria: tmpl.evaluationCriteria,
          requiredPhrases: tmpl.requiredPhrases,
          scoringWeights: tmpl.scoringWeights,
          additionalInstructions: tmpl.additionalInstructions,
        };
      }
    } catch (err) {
      logger.warn({ callId, err }, "Failed to load prompt template for email (using defaults)");
    }

    // Load reference documents (RAG or full-text)
    try {
      const refDocs = await storage.getReferenceDocumentsForCategory(orgId, emailCategory);
      const docsWithText = refDocs.filter(d => d.extractedText && d.extractedText.length > 0);
      if (docsWithText.length > 0) {
        if (!promptTemplate) promptTemplate = {};

        let useRag = false;
        try {
          const sub = await storage.getSubscription(orgId);
          const tier = (sub?.planTier as PlanTier) || "free";
          useRag = PLAN_DEFINITIONS[tier]?.limits?.ragEnabled === true;
        } catch { /* default to non-RAG */ }

        if (useRag && process.env.DATABASE_URL) {
          try {
            const { getDatabase } = await import("../db/index");
            const db = getDatabase();
            if (db) {
              const docIds = docsWithText.map(d => d.id);
              const queryText = transcriptText.slice(0, 2000);
              const chunks = await searchRelevantChunks(db as any, orgId, queryText, docIds, { topK: 6 });
              if (chunks.length > 0) {
                promptTemplate.referenceDocuments = [{
                  name: "Retrieved Knowledge Base Context",
                  category: "rag_retrieval",
                  text: formatRetrievedContext(chunks),
                }];
              }
            }
          } catch (ragErr) {
            logger.warn({ callId, err: ragErr }, "RAG retrieval failed for email, falling back to full-text");
          }
        }

        if (!promptTemplate.referenceDocuments) {
          promptTemplate.referenceDocuments = docsWithText.map(d => ({
            name: d.name,
            category: d.category,
            text: d.extractedText!,
          }));
        }
      }
    } catch (refErr) {
      logger.warn({ callId, err: refErr }, "Failed to load reference docs for email");
    }

    // Step 3: Run AI analysis
    let aiAnalysis = null;
    if (aiProvider.isAvailable) {
      try {
        // Use email-specific system prompt
        aiAnalysis = await withRetry(
          () => aiProvider.analyzeCallTranscript(transcriptText, callId, emailCategory, promptTemplate),
          { retries: 2, baseDelay: 2000, label: `Email analysis for ${callId}` }
        );
        logger.info({ callId }, "Email AI analysis complete");
      } catch (aiError) {
        logger.warn({ callId, err: aiError }, "Email AI analysis failed (using defaults)");
      }
    }

    // Step 4: Build and store sentiment analysis
    const sentimentScore = aiAnalysis?.sentiment_score ?? 0.5;
    const sentimentLabel = sentimentScore > 0.6 ? "positive" : sentimentScore < 0.4 ? "negative" : "neutral";

    await storage.createSentimentAnalysis(orgId, {
      orgId,
      callId,
      overallSentiment: (aiAnalysis?.sentiment || sentimentLabel) as "positive" | "neutral" | "negative",
      overallScore: String(sentimentScore),
      segments: [], // No segments for email (no timestamps)
    });

    // Step 5: Build and store call analysis
    const performanceScore = aiAnalysis?.performance_score ?? 5.0;
    const clampedScore = Math.max(0, Math.min(10, performanceScore));

    // Server-side flag enforcement (same as voice calls)
    const flags: string[] = [...(aiAnalysis?.flags || [])];
    if (clampedScore <= 2.0 && !flags.includes("low_score")) flags.push("low_score");
    if (clampedScore >= 9.0 && !flags.includes("exceptional_call")) flags.push("exceptional_call");
    flags.push("email"); // Always tag emails

    const subScores = aiAnalysis?.sub_scores ? {
      compliance: aiAnalysis.sub_scores.compliance ?? 0,
      customerExperience: aiAnalysis.sub_scores.customer_experience ?? 0,
      communication: aiAnalysis.sub_scores.communication ?? 0,
      resolution: aiAnalysis.sub_scores.resolution ?? 0,
    } : undefined;

    const analysis = await storage.createCallAnalysis(orgId, {
      orgId,
      callId,
      performanceScore: String(clampedScore),
      summary: aiAnalysis?.summary || "Email submitted for review.",
      topics: aiAnalysis?.topics || [],
      actionItems: aiAnalysis?.action_items || [],
      feedback: aiAnalysis?.feedback || { strengths: [], suggestions: [] },
      callPartyType: aiAnalysis?.call_party_type || "customer",
      flags,
      subScores,
      detectedAgentName: aiAnalysis?.detected_agent_name || undefined,
      confidenceScore: aiAnalysis ? "0.95" : "0.30",
      confidenceFactors: {
        transcriptConfidence: 1.0,
        wordCount: body.split(/\s+/).length,
        callDurationSeconds: 0,
        transcriptLength: body.length,
        aiAnalysisCompleted: aiAnalysis !== null,
        overallScore: aiAnalysis ? 0.95 : 0.30,
      },
    });

    // Step 6: Auto-assign to employee if agent name detected
    if (aiAnalysis?.detected_agent_name) {
      try {
        const employees = await storage.getAllEmployees(orgId);
        const activeEmployees = employees.filter(e => e.status === "Active");
        const agentName = aiAnalysis.detected_agent_name.toLowerCase().trim();
        const exact = activeEmployees.filter(e => e.name.toLowerCase().trim() === agentName);
        if (exact.length === 1) {
          await storage.updateCall(orgId, callId, { employeeId: exact[0].id });
        }
      } catch (assignErr) {
        logger.warn({ callId, err: assignErr }, "Failed to auto-assign email to employee");
      }
    }

    // Step 7: Finalize
    await storage.updateCall(orgId, callId, { status: "completed" });

    broadcastCallUpdate(callId, "completed", { step: 3, totalSteps: 3, label: "Email analysis complete" }, orgId);

    // Track usage (email analysis is much cheaper — no transcription cost)
    try {
      const bedrockCost = estimateBedrockCost("us.anthropic.claude-sonnet-4-6", Math.ceil(body.length / 4), 500);
      const usageRecord: UsageRecord = {
        id: randomUUID(),
        orgId,
        callId,
        type: "call",
        timestamp: new Date().toISOString(),
        user: userName || "system",
        services: {
          bedrock: {
            model: "us.anthropic.claude-sonnet-4-6",
            estimatedInputTokens: Math.ceil(body.length / 4),
            estimatedOutputTokens: 500,
            estimatedCost: bedrockCost,
          },
          // No AssemblyAI cost for email!
        },
        totalEstimatedCost: bedrockCost,
      };
      await storage.createUsageRecord(orgId, usageRecord);
    } catch (usageErr) {
      logger.warn({ callId, err: usageErr }, "Failed to track email usage");
    }

    // Notify if flagged
    if (flags.some(f => ["low_score", "agent_misconduct", "escalation_needed"].some(s => f.includes(s)))) {
      try {
        await notifyFlaggedCall({
          event: "call_flagged",
          callId,
          orgId,
          flags,
          performanceScore: clampedScore,
          fileName: `Email: ${subject}`,
          summary: aiAnalysis?.summary,
          timestamp: new Date().toISOString(),
        });
      } catch (notifErr) {
        logger.warn({ callId, err: notifErr }, "Failed to send notification for flagged email");
      }
    }

    // Record usage event for quota tracking
    try {
      await trackUsage({ orgId, eventType: "ai_analysis", quantity: 1, metadata: { callId, channel: "email" } });
    } catch (trackErr) {
      logger.warn({ callId, err: trackErr }, "Failed to track email analysis usage event");
    }

    // Trigger proactive alerts
    try {
      await onCallAnalysisComplete(orgId, callId);
    } catch (alertErr) {
      logger.warn({ callId, err: alertErr }, "Failed to run proactive alerts for email");
    }

    logger.info({ callId, channel: "email", performanceScore: clampedScore }, "Email analysis complete");
  } catch (error) {
    logger.error({ err: error, callId }, "Email analysis pipeline failed");
    try {
      await storage.updateCall(orgId, callId, { status: "failed" });
      broadcastCallUpdate(callId, "failed", { error: "Email analysis failed" }, orgId);
    } catch { /* best-effort status update */ }
  }
}
