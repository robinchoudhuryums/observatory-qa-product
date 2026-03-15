import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext, hashPassword } from "../auth";
import { aiProvider } from "../services/ai-factory";
import { assemblyAIService } from "../services/assemblyai";
import { broadcastCallUpdate } from "../services/websocket";
import { insertPromptTemplateSchema, orgSettingsSchema, type OrgSettings } from "@shared/schema";
import { logger } from "../services/logger";
import { queryAuditLogs, verifyAuditChain } from "../services/audit-log";
import { safeInt, withRetry } from "./helpers";
import { enqueueReanalysis } from "../services/queue";

export function registerAdminRoutes(app: Express): void {
  // ==================== PROMPT TEMPLATE ROUTES (admin only) ====================

  app.get("/api/prompt-templates", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const templates = await storage.getAllPromptTemplates(req.orgId!);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch prompt templates" });
    }
  });

  app.post("/api/prompt-templates", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const parsed = insertPromptTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: parsed.error.flatten() });
        return;
      }
      const template = await storage.createPromptTemplate(req.orgId!, {
        ...parsed.data,
        updatedBy: req.user?.username,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to create prompt template" });
    }
  });

  app.patch("/api/prompt-templates/:id", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      // Validate the update: allow only known template fields
      const { updatedBy: _ignore, id: _ignoreId, ...bodyWithoutMeta } = req.body;
      const templateUpdateParsed = insertPromptTemplateSchema.partial().safeParse(bodyWithoutMeta);
      if (!templateUpdateParsed.success) {
        res.status(400).json({ message: "Invalid template data", errors: templateUpdateParsed.error.flatten() });
        return;
      }
      const updated = await storage.updatePromptTemplate(req.orgId!, req.params.id, {
        ...templateUpdateParsed.data,
        updatedBy: req.user?.username,
      });
      if (!updated) {
        res.status(404).json({ message: "Template not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update prompt template" });
    }
  });

  app.delete("/api/prompt-templates/:id", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      await storage.deletePromptTemplate(req.orgId!, req.params.id);
      res.json({ message: "Template deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // Bulk re-analysis: re-analyze recent calls using updated prompt template
  app.post("/api/calls/reanalyze", requireAuth, injectOrgContext, requireRole("admin"), async (req, res) => {
    try {
      const { callCategory, limit: maxCalls } = req.body;
      if (!callCategory || typeof callCategory !== "string") {
        res.status(400).json({ message: "callCategory is required" });
        return;
      }

      if (!aiProvider.isAvailable) {
        res.status(503).json({ message: "AI provider not configured" });
        return;
      }

      const reanalysisLimit = Math.min(safeInt(maxCalls, 10), 50);
      const allCalls = await storage.getCallsWithDetails(req.orgId!, { status: "completed" });

      // Filter to calls matching the category
      const targetCalls = allCalls
        .filter(c => c.callCategory === callCategory && c.transcript?.text)
        .slice(0, reanalysisLimit);

      if (targetCalls.length === 0) {
        res.json({ message: "No matching calls found", queued: 0 });
        return;
      }

      // Load the prompt template for this category
      let promptTemplate = undefined;
      const tmpl = await storage.getPromptTemplateByCategory(req.orgId!, callCategory);
      if (tmpl) {
        promptTemplate = {
          evaluationCriteria: tmpl.evaluationCriteria,
          requiredPhrases: tmpl.requiredPhrases,
          scoringWeights: tmpl.scoringWeights,
          additionalInstructions: tmpl.additionalInstructions,
        };
      }

      const orgId = req.orgId!;
      const queued = targetCalls.length;
      const callIds = targetCalls.map(c => c.id);

      // Try BullMQ queue first; fall back to in-process execution
      const enqueued = await enqueueReanalysis({
        orgId,
        callIds,
        requestedBy: req.user?.username || "unknown",
      });

      if (enqueued) {
        res.json({ message: `Re-analysis queued for ${queued} calls`, queued });
        return;
      }

      // Fallback: in-process execution (no Redis)
      res.json({ message: `Re-analysis started for ${queued} calls (in-process)`, queued });

      (async () => {
        let succeeded = 0;
        let failed = 0;
        for (const call of targetCalls) {
          try {
            const transcriptText = call.transcript!.text!;
            const aiAnalysis = await withRetry(
              () => aiProvider.analyzeCallTranscript(transcriptText, call.id, callCategory, promptTemplate),
              { retries: 1, baseDelay: 2000, label: `reanalyze ${call.id}` }
            );

            const { analysis } = assemblyAIService.processTranscriptData(
              { id: "", status: "completed", text: transcriptText, words: call.transcript?.words as any },
              aiAnalysis,
              call.id
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
          } catch (error) {
            logger.error({ err: error, callId: call.id }, "Reanalysis failed for call");
            failed++;
          }
        }
        logger.info({ succeeded, failed, total: queued }, "Reanalysis complete");
        broadcastCallUpdate("bulk", "reanalysis_complete", { succeeded, failed, total: queued }, orgId);
      })().catch(err => logger.error({ err }, "Bulk re-analysis failed"));
    } catch (error) {
      logger.error({ err: error }, "Failed to start re-analysis");
      res.status(500).json({ message: "Failed to start re-analysis" });
    }
  });

  // ============================================================
  // USER MANAGEMENT (database-backed, admin only)
  // ============================================================

  // List all users in the current organization
  app.get("/api/users", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const users = await storage.listUsersByOrg(req.orgId!);
      // Return users without password hashes
      res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        orgId: u.orgId,
        createdAt: u.createdAt,
      })));
    } catch (error) {
      logger.error({ err: error }, "Failed to list users");
      res.status(500).json({ message: "Failed to list users" });
    }
  });

  // Create a new user (admin only)
  app.post("/api/users", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { username, password, name, role } = req.body;
      if (!username || !password || !name) {
        return res.status(400).json({ message: "username, password, and name are required" });
      }
      if (!["viewer", "manager", "admin"].includes(role || "viewer")) {
        return res.status(400).json({ message: "Invalid role" });
      }

      // Check if username already exists
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }

      const passwordHash = await hashPassword(password);

      const user = await storage.createUser({
        orgId: req.orgId!,
        username,
        passwordHash,
        name,
        role: role || "viewer",
      });

      logger.info({ userId: user.id, username, org: req.orgId }, "User created");
      res.status(201).json({ id: user.id, username: user.username, name: user.name, role: user.role });
    } catch (error) {
      logger.error({ err: error }, "Failed to create user");
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Update user (admin only)
  app.patch("/api/users/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { name, role, password } = req.body;

      if (role && !["viewer", "manager", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      const updates: Record<string, unknown> = {};
      if (name) updates.name = name;
      if (role) updates.role = role;

      // Hash new password if provided
      if (password) {
        updates.passwordHash = await hashPassword(password);
      }

      const updated = await storage.updateUser(req.orgId!, req.params.id, updates as any);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }

      logger.info({ userId: req.params.id, org: req.orgId }, "User updated");
      res.json({ id: updated.id, username: updated.username, name: updated.name, role: updated.role });
    } catch (error) {
      logger.error({ err: error }, "Failed to update user");
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      // Prevent self-deletion
      if (req.params.id === req.user!.id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      const user = await storage.getUser(req.params.id);
      if (!user || user.orgId !== req.orgId) {
        return res.status(404).json({ message: "User not found" });
      }

      await storage.deleteUser(req.orgId!, req.params.id);
      logger.info({ userId: req.params.id, org: req.orgId }, "User deleted");
      res.json({ message: "User deleted" });
    } catch (error) {
      logger.error({ err: error }, "Failed to delete user");
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // ============================================================
  // ORGANIZATION MANAGEMENT (admin only)
  // ============================================================

  // Get current org details
  app.get("/api/organization", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(org);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  // Update org settings (admin only)
  app.patch("/api/organization/settings", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.orgId!);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const parsed = orgSettingsSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
      }
      const updatedSettings = { ...(org.settings || {}), ...parsed.data } as OrgSettings;
      const updated = await storage.updateOrganization(req.orgId!, { settings: updatedSettings });
      logger.info({ org: req.orgId }, "Organization settings updated");
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update organization settings");
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // ============================================================
  // AUDIT LOG VIEWER (admin only)
  // ============================================================

  app.get("/api/admin/audit-logs", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const { event, userId, resourceType, from, to, page, limit } = req.query;
      const pageNum = Math.max(1, safeInt(page, 1));
      const pageLimit = Math.min(safeInt(limit, 50), 200);

      const result = await queryAuditLogs({
        orgId: req.orgId!,
        event: event as string | undefined,
        userId: userId as string | undefined,
        resourceType: resourceType as string | undefined,
        from: from ? new Date(from as string) : undefined,
        to: to ? new Date(to as string) : undefined,
        limit: pageLimit,
        offset: (pageNum - 1) * pageLimit,
      });

      res.json({
        entries: result.entries,
        total: result.total,
        page: pageNum,
        pageSize: pageLimit,
        totalPages: Math.ceil(result.total / pageLimit),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch audit logs");
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  // Verify audit log integrity (tamper detection)
  app.get("/api/admin/audit-logs/verify", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const result = await verifyAuditChain(req.orgId!);
      res.json({
        ...result,
        message: result.valid
          ? `Audit chain verified: ${result.checkedCount} entries, no tampering detected.`
          : `Audit chain BROKEN at sequence ${result.brokenAt}. Possible tampering detected.`,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to verify audit chain");
      res.status(500).json({ message: "Failed to verify audit chain integrity" });
    }
  });
}
