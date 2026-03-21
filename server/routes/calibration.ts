import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";

export function registerCalibrationRoutes(app: Express) {
  // Create a calibration session (manager+ only)
  app.post("/api/calibration", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { title, callId, evaluatorIds, scheduledAt } = req.body;
      if (!title || !callId || !evaluatorIds || !Array.isArray(evaluatorIds) || evaluatorIds.length === 0) {
        return res.status(400).json({ message: "title, callId, and evaluatorIds (non-empty array) are required" });
      }

      // Verify the call exists
      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const session = await storage.createCalibrationSession(orgId, {
        orgId,
        title,
        callId,
        facilitatorId: req.user!.id,
        evaluatorIds,
        scheduledAt,
        status: "scheduled",
      });

      logger.info({ orgId, sessionId: session.id, evaluatorCount: evaluatorIds.length }, "Calibration session created");
      res.json(session);
    } catch (error) {
      logger.error({ err: error }, "Failed to create calibration session");
      res.status(500).json({ message: "Failed to create calibration session" });
    }
  });

  // List calibration sessions
  app.get("/api/calibration", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { status } = req.query;
      const sessions = await storage.listCalibrationSessions(orgId, {
        status: status as string | undefined,
      });

      // Enrich with call details and evaluation stats
      const enriched = await Promise.all(sessions.map(async (session) => {
        const call = await storage.getCall(orgId, session.callId);
        const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);

        // Calculate score variance
        let scoreVariance: number | undefined;
        if (evaluations.length >= 2) {
          const scores = evaluations.map(e => e.performanceScore);
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
          const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
          scoreVariance = Math.round(Math.sqrt(variance) * 100) / 100;
        }

        return {
          ...session,
          callFileName: call?.fileName,
          callCategory: call?.callCategory,
          evaluationCount: evaluations.length,
          expectedEvaluations: session.evaluatorIds.length,
          scoreVariance,
          avgScore: evaluations.length > 0
            ? Math.round((evaluations.reduce((s, e) => s + e.performanceScore, 0) / evaluations.length) * 10) / 10
            : null,
        };
      }));

      res.json(enriched);
    } catch (error) {
      logger.error({ err: error }, "Failed to list calibration sessions");
      res.status(500).json({ message: "Failed to list calibration sessions" });
    }
  });

  // Get a calibration session with all evaluations
  app.get("/api/calibration/:id", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const session = await storage.getCalibrationSession(orgId, req.params.id);
      if (!session) return res.status(404).json({ message: "Calibration session not found" });

      const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
      const call = await storage.getCall(orgId, session.callId);
      const analysis = await storage.getCallAnalysis(orgId, session.callId);

      // Enrich evaluator names
      const users = await storage.listUsersByOrg(orgId);
      const userMap = new Map(users.map(u => [u.id, u]));

      const enrichedEvaluations = evaluations.map(e => ({
        ...e,
        evaluatorName: userMap.get(e.evaluatorId)?.name || "Unknown",
      }));

      // Calculate variance
      let scoreVariance: number | undefined;
      if (evaluations.length >= 2) {
        const scores = evaluations.map(e => e.performanceScore);
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
        scoreVariance = Math.round(Math.sqrt(variance) * 100) / 100;
      }

      res.json({
        ...session,
        evaluations: enrichedEvaluations,
        scoreVariance,
        call,
        aiScore: analysis?.performanceScore ? parseFloat(String(analysis.performanceScore)) : null,
        facilitatorName: userMap.get(session.facilitatorId)?.name || "Unknown",
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get calibration session");
      res.status(500).json({ message: "Failed to get calibration session" });
    }
  });

  // Submit an evaluation for a calibration session
  app.post("/api/calibration/:id/evaluate", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const session = await storage.getCalibrationSession(orgId, req.params.id);
      if (!session) return res.status(404).json({ message: "Calibration session not found" });

      // Verify user is an evaluator
      if (!session.evaluatorIds.includes(req.user!.id) && session.facilitatorId !== req.user!.id) {
        return res.status(403).json({ message: "You are not an evaluator for this session" });
      }

      const { performanceScore, subScores, notes } = req.body;
      if (performanceScore === undefined || performanceScore < 0 || performanceScore > 10) {
        return res.status(400).json({ message: "performanceScore (0-10) is required" });
      }

      // Check for existing evaluation
      const existing = await storage.getCalibrationEvaluations(orgId, session.id);
      const myEval = existing.find(e => e.evaluatorId === req.user!.id);

      if (myEval) {
        // Update existing evaluation
        const updated = await storage.updateCalibrationEvaluation(orgId, myEval.id, {
          performanceScore, subScores, notes,
        });
        res.json(updated);
      } else {
        const evaluation = await storage.createCalibrationEvaluation(orgId, {
          orgId,
          sessionId: session.id,
          evaluatorId: req.user!.id,
          performanceScore,
          subScores,
          notes,
        });

        // Auto-transition to in_progress when first evaluation comes in
        if (session.status === "scheduled") {
          await storage.updateCalibrationSession(orgId, session.id, { status: "in_progress" });
        }

        res.json(evaluation);
      }

      logger.info({ orgId, sessionId: session.id, evaluatorId: req.user!.id }, "Calibration evaluation submitted");
    } catch (error) {
      logger.error({ err: error }, "Failed to submit calibration evaluation");
      res.status(500).json({ message: "Failed to submit evaluation" });
    }
  });

  // Complete calibration session (set consensus score and notes)
  app.post("/api/calibration/:id/complete", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const session = await storage.getCalibrationSession(orgId, req.params.id);
      if (!session) return res.status(404).json({ message: "Calibration session not found" });

      const { targetScore, consensusNotes } = req.body;

      const updated = await storage.updateCalibrationSession(orgId, session.id, {
        status: "completed",
        targetScore,
        consensusNotes,
        completedAt: new Date().toISOString(),
      });

      logger.info({ orgId, sessionId: session.id, targetScore }, "Calibration session completed");
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to complete calibration session");
      res.status(500).json({ message: "Failed to complete calibration session" });
    }
  });

  // Delete calibration session (manager+)
  app.delete("/api/calibration/:id", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      await storage.deleteCalibrationSession(orgId, req.params.id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete calibration session");
      res.status(500).json({ message: "Failed to delete calibration session" });
    }
  });

  // Get calibration analytics (score variance trends, evaluator alignment)
  app.get("/api/calibration/analytics", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const sessions = await storage.listCalibrationSessions(orgId, { status: "completed" });
      const analytics = {
        totalSessions: sessions.length,
        avgVariance: 0,
        varianceTrend: [] as Array<{ date: string; variance: number }>,
        evaluatorStats: {} as Record<string, { avgDeviation: number; sessionsParticipated: number }>,
      };

      const variances: number[] = [];

      for (const session of sessions) {
        const evaluations = await storage.getCalibrationEvaluations(orgId, session.id);
        if (evaluations.length < 2) continue;

        const scores = evaluations.map(e => e.performanceScore);
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length);
        variances.push(variance);

        analytics.varianceTrend.push({
          date: session.completedAt || session.createdAt || "",
          variance: Math.round(variance * 100) / 100,
        });

        // Per-evaluator stats
        const target = session.targetScore ?? mean;
        for (const ev of evaluations) {
          if (!analytics.evaluatorStats[ev.evaluatorId]) {
            analytics.evaluatorStats[ev.evaluatorId] = { avgDeviation: 0, sessionsParticipated: 0 };
          }
          const stat = analytics.evaluatorStats[ev.evaluatorId];
          const deviation = Math.abs(ev.performanceScore - target);
          stat.avgDeviation = (stat.avgDeviation * stat.sessionsParticipated + deviation) / (stat.sessionsParticipated + 1);
          stat.sessionsParticipated++;
        }
      }

      analytics.avgVariance = variances.length > 0
        ? Math.round((variances.reduce((a, b) => a + b, 0) / variances.length) * 100) / 100
        : 0;

      res.json(analytics);
    } catch (error) {
      logger.error({ err: error }, "Failed to get calibration analytics");
      res.status(500).json({ message: "Failed to get calibration analytics" });
    }
  });
}
