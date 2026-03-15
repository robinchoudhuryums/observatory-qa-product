import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { insertCoachingSessionSchema } from "@shared/schema";
import { z } from "zod";
import { generateRecommendations, saveRecommendations, generateCoachingPlan, calculateEffectiveness } from "../services/coaching-engine";
import { getManagerReviewQueue, generateWeeklyDigest } from "../services/proactive-alerts";
import { sendDigestNotification } from "../services/notifications";
import { logger } from "../services/logger";

export function registerCoachingRoutes(app: Express): void {
  // ==================== COACHING ROUTES ====================

  // List all coaching sessions (managers and admins)
  app.get("/api/coaching", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const sessions = await storage.getAllCoachingSessions(req.orgId!);
      // Enrich with employee names
      const enriched = await Promise.all(sessions.map(async s => {
        const emp = await storage.getEmployee(req.orgId!, s.employeeId);
        return { ...s, employeeName: emp?.name || "Unknown" };
      }));
      res.json(enriched.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Get coaching sessions for a specific employee
  app.get("/api/coaching/employee/:employeeId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const sessions = await storage.getCoachingSessionsByEmployee(req.orgId!, req.params.employeeId);
      res.json(sessions.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch coaching sessions" });
    }
  });

  // Create a coaching session (managers and admins)
  app.post("/api/coaching", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = insertCoachingSessionSchema.safeParse({
        ...req.body,
        assignedBy: req.user?.name || req.user?.username || "Unknown",
      });
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid coaching data", errors: parsed.error.flatten() });
        return;
      }
      const session = await storage.createCoachingSession(req.orgId!, parsed.data);
      res.status(201).json(session);
    } catch (error) {
      res.status(500).json({ message: "Failed to create coaching session" });
    }
  });

  // Update a coaching session (status, notes, action plan progress)
  const updateCoachingSchema = z.object({
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    notes: z.string().optional(),
    actionPlan: z.array(z.object({ task: z.string(), completed: z.boolean() })).optional(),
    title: z.string().min(1).optional(),
    category: z.string().optional(),
    dueDate: z.string().optional(),
  }).strict();

  app.patch("/api/coaching/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const parsed = updateCoachingSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid update data", errors: parsed.error.flatten() });
        return;
      }
      const updates: Record<string, any> = { ...parsed.data };
      if (updates.status === "completed") {
        updates.completedAt = new Date().toISOString();
      }
      const updated = await storage.updateCoachingSession(req.orgId!, req.params.id, updates);
      if (!updated) {
        res.status(404).json({ message: "Coaching session not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update coaching session" });
    }
  });

  // ==================== COACHING RECOMMENDATIONS ====================

  // Get recommendations for the org (or filtered by employee)
  app.get("/api/coaching/recommendations", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) {
        res.json([]);
        return;
      }

      const { coachingRecommendations } = await import("../db/schema");
      const { eq, and, desc } = await import("drizzle-orm");

      const conditions = [eq(coachingRecommendations.orgId, req.orgId!)];
      const employeeId = req.query.employeeId as string | undefined;
      if (employeeId) {
        conditions.push(eq(coachingRecommendations.employeeId, employeeId));
      }
      const status = req.query.status as string | undefined;
      if (status) {
        conditions.push(eq(coachingRecommendations.status, status));
      }

      const rows = await db.select().from(coachingRecommendations)
        .where(and(...conditions))
        .orderBy(desc(coachingRecommendations.createdAt))
        .limit(50);

      res.json(rows);
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch coaching recommendations");
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  // Trigger recommendation generation for an employee
  app.post("/api/coaching/recommendations/generate", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { employeeId } = req.body;
      if (!employeeId) {
        res.status(400).json({ message: "employeeId is required" });
        return;
      }

      const recs = await generateRecommendations(req.orgId!, employeeId);
      const saved = await saveRecommendations(req.orgId!, recs);

      res.json({ generated: recs.length, saved, recommendations: recs });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate recommendations");
      res.status(500).json({ message: "Failed to generate recommendations" });
    }
  });

  // Update recommendation status (accept → create coaching session, or dismiss)
  app.patch("/api/coaching/recommendations/:id", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const { status } = req.body;
      if (!status || !["accepted", "dismissed"].includes(status)) {
        res.status(400).json({ message: "status must be 'accepted' or 'dismissed'" });
        return;
      }

      const { getDatabase } = await import("../db/index");
      const db = getDatabase();
      if (!db) {
        res.status(503).json({ message: "Database not available" });
        return;
      }

      const { coachingRecommendations } = await import("../db/schema");
      const { eq, and } = await import("drizzle-orm");

      const [rec] = await db.select().from(coachingRecommendations)
        .where(and(
          eq(coachingRecommendations.id, req.params.id),
          eq(coachingRecommendations.orgId, req.orgId!),
        ))
        .limit(1);

      if (!rec) {
        res.status(404).json({ message: "Recommendation not found" });
        return;
      }

      await db.update(coachingRecommendations)
        .set({ status })
        .where(eq(coachingRecommendations.id, req.params.id));

      res.json({ ...rec, status });
    } catch (error) {
      logger.error({ err: error }, "Failed to update recommendation");
      res.status(500).json({ message: "Failed to update recommendation" });
    }
  });

  // ==================== AI COACHING PLAN ====================

  // Generate AI coaching plan for a session
  app.post("/api/coaching/:id/generate-plan", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const result = await generateCoachingPlan(req.orgId!, req.params.id);
      if (!result) {
        res.status(404).json({ message: "Session not found or AI not available" });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate coaching plan");
      res.status(500).json({ message: "Failed to generate coaching plan" });
    }
  });

  // ==================== COACHING EFFECTIVENESS ====================

  // Get effectiveness metrics for a coaching session
  app.get("/api/coaching/:id/effectiveness", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const result = await calculateEffectiveness(req.orgId!, req.params.id);
      if (!result) {
        res.json({ message: "Not enough data to calculate effectiveness", data: null });
        return;
      }
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to calculate coaching effectiveness");
      res.status(500).json({ message: "Failed to calculate effectiveness" });
    }
  });

  // ==================== MANAGER REVIEW QUEUE ====================

  // Get prioritized agent review queue
  app.get("/api/coaching/review-queue", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const queue = await getManagerReviewQueue(req.orgId!);
      res.json(queue);
    } catch (error) {
      logger.error({ err: error }, "Failed to get review queue");
      res.status(500).json({ message: "Failed to get review queue" });
    }
  });

  // ==================== WEEKLY DIGEST ====================

  // Generate and optionally send weekly digest
  app.get("/api/coaching/digest", requireAuth, injectOrgContext, requireRole("manager", "admin"), async (req, res) => {
    try {
      const digest = await generateWeeklyDigest(req.orgId!);
      res.json(digest);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate digest");
      res.status(500).json({ message: "Failed to generate digest" });
    }
  });

  // Send the weekly digest to configured webhook
  app.post("/api/coaching/digest/send", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const digest = await generateWeeklyDigest(req.orgId!);
      const sent = await sendDigestNotification(digest);
      res.json({ sent, digest });
    } catch (error) {
      logger.error({ err: error }, "Failed to send digest");
      res.status(500).json({ message: "Failed to send digest" });
    }
  });
}
