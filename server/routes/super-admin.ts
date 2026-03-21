import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireSuperAdmin } from "../auth";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";

/**
 * Super-admin routes — platform-level administration.
 * All routes require super_admin role (configured via SUPER_ADMIN_USERS env var).
 * These routes are NOT org-scoped — they operate across all organizations.
 */
export function registerSuperAdminRoutes(app: Express): void {
  // ==================== PLATFORM-WIDE STATS ====================

  /**
   * GET /api/super-admin/stats
   * Platform-wide statistics: total orgs, users, calls, active subscriptions.
   */
  app.get("/api/super-admin/stats", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const orgs = await storage.listOrganizations();

      let totalUsers = 0;
      let totalCalls = 0;
      let activeSubscriptions = 0;

      for (const org of orgs) {
        const [users, calls, subscription] = await Promise.all([
          storage.listUsersByOrg(org.id),
          storage.getAllCalls(org.id),
          storage.getSubscription(org.id),
        ]);
        totalUsers += users.length;
        totalCalls += calls.length;
        if (subscription && subscription.status === "active") {
          activeSubscriptions++;
        }
      }

      const orgsByStatus = {
        active: orgs.filter(o => o.status === "active").length,
        suspended: orgs.filter(o => o.status === "suspended").length,
        trial: orgs.filter(o => o.status === "trial").length,
      };

      res.json({
        totalOrganizations: orgs.length,
        totalUsers,
        totalCalls,
        activeSubscriptions,
        orgsByStatus,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch platform stats");
      res.status(500).json({ message: "Failed to fetch platform stats" });
    }
  });

  // ==================== ORGANIZATION MANAGEMENT ====================

  /**
   * GET /api/super-admin/organizations
   * List all organizations with stats (user count, call count, subscription status).
   */
  app.get("/api/super-admin/organizations", requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const orgs = await storage.listOrganizations();

      const orgsWithStats = await Promise.all(
        orgs.map(async (org) => {
          const [users, calls, subscription] = await Promise.all([
            storage.listUsersByOrg(org.id),
            storage.getAllCalls(org.id),
            storage.getSubscription(org.id),
          ]);

          return {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
            createdAt: org.createdAt,
            settings: {
              industryType: org.settings?.industryType,
              retentionDays: org.settings?.retentionDays,
            },
            stats: {
              userCount: users.length,
              callCount: calls.length,
              subscriptionStatus: subscription?.status || "none",
              planTier: subscription?.planTier || "free",
            },
          };
        })
      );

      res.json(orgsWithStats);
    } catch (error) {
      logger.error({ err: error }, "Failed to list organizations");
      res.status(500).json({ message: "Failed to list organizations" });
    }
  });

  /**
   * GET /api/super-admin/organizations/:id
   * Get detailed information about a specific organization.
   */
  app.get("/api/super-admin/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const [users, calls, subscription] = await Promise.all([
        storage.listUsersByOrg(org.id),
        storage.getAllCalls(org.id),
        storage.getSubscription(org.id),
      ]);

      // Compute call status breakdown
      const callsByStatus = {
        pending: calls.filter(c => c.status === "pending").length,
        processing: calls.filter(c => c.status === "processing").length,
        completed: calls.filter(c => c.status === "completed").length,
        failed: calls.filter(c => c.status === "failed").length,
      };

      res.json({
        ...org,
        stats: {
          userCount: users.length,
          callCount: calls.length,
          callsByStatus,
          subscriptionStatus: subscription?.status || "none",
          planTier: subscription?.planTier || "free",
          billingInterval: subscription?.billingInterval,
          currentPeriodEnd: subscription?.currentPeriodEnd,
        },
        users: users.map(u => ({
          id: u.id,
          username: u.username,
          name: u.name,
          role: u.role,
          createdAt: u.createdAt,
        })),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to fetch organization details");
      res.status(500).json({ message: "Failed to fetch organization details" });
    }
  });

  /**
   * PATCH /api/super-admin/organizations/:id
   * Update an organization's status or settings (super admin only).
   */
  app.patch("/api/super-admin/organizations/:id", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const { status, settings, name } = req.body;
      const updates: Record<string, unknown> = {};

      if (status && ["active", "suspended", "trial"].includes(status)) {
        updates.status = status;
      }
      if (name && typeof name === "string") {
        updates.name = name;
      }
      if (settings && typeof settings === "object") {
        // Merge with existing settings
        updates.settings = { ...(org.settings || {}), ...settings };
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updated = await storage.updateOrganization(req.params.id, updates as any);

      // Audit log
      logPhiAccess({
        ...auditContext(req),
        event: "super_admin_org_update",
        resourceType: "organization",
        resourceId: req.params.id,
        detail: JSON.stringify({ changedFields: Object.keys(updates) }),
      });

      logger.info({ orgId: req.params.id, changedFields: Object.keys(updates), superAdmin: req.user?.username }, "Super admin updated organization");
      res.json(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update organization");
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  /**
   * POST /api/super-admin/organizations/:id/impersonate
   * Set session to act as an admin of the target organization.
   * This is a session-level flag — it does NOT permanently change the user.
   * Use DELETE /api/super-admin/impersonate to stop impersonating.
   */
  app.post("/api/super-admin/organizations/:id/impersonate", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const org = await storage.getOrganization(req.params.id);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }

      const session = req.session as any;
      session.impersonatingOrgId = org.id;
      session.originalOrgId = req.user!.orgId;

      // Audit log — impersonation is a sensitive action
      logPhiAccess({
        ...auditContext(req),
        event: "super_admin_impersonate_start",
        resourceType: "organization",
        resourceId: org.id,
        detail: `Super admin ${req.user!.username} started impersonating org "${org.name}" (${org.slug})`,
      });

      logger.warn({ superAdmin: req.user?.username, targetOrg: org.slug, orgId: org.id }, "Super admin started org impersonation");
      res.json({
        message: `Now impersonating organization "${org.name}" (${org.slug})`,
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to start impersonation");
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  /**
   * DELETE /api/super-admin/impersonate
   * Stop impersonating an organization and return to the super admin's own context.
   */
  app.delete("/api/super-admin/impersonate", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const session = req.session as any;
      const wasImpersonating = session.impersonatingOrgId;

      if (!wasImpersonating) {
        return res.status(400).json({ message: "Not currently impersonating any organization" });
      }

      // Audit log
      logPhiAccess({
        ...auditContext(req),
        event: "super_admin_impersonate_stop",
        resourceType: "organization",
        resourceId: wasImpersonating,
        detail: `Super admin ${req.user!.username} stopped impersonating org ${wasImpersonating}`,
      });

      delete session.impersonatingOrgId;
      delete session.originalOrgId;

      logger.info({ superAdmin: req.user?.username, previousOrgId: wasImpersonating }, "Super admin stopped org impersonation");
      res.json({ message: "Stopped impersonating organization" });
    } catch (error) {
      logger.error({ err: error }, "Failed to stop impersonation");
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });
}
