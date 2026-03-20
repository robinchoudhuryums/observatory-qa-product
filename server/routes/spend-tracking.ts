import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";

export function registerSpendTrackingRoutes(app: Express): void {

  // Get all usage/spend records for the org
  app.get("/api/usage", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const records = await storage.getUsageRecords(req.orgId!);
      res.json(records);
    } catch (error) {
      logger.error({ err: error }, "Error fetching usage records");
      res.status(500).json({ message: "Failed to fetch usage records" });
    }
  });
}
