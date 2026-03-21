import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";

export function registerSpendTrackingRoutes(app: Express): void {

  // Get usage/spend records with optional date filtering and pagination
  app.get("/api/usage", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const records = await storage.getUsageRecords(req.orgId!);

      // Date filtering
      const { from, to, type, limit, offset } = req.query;
      let filtered = records;

      if (from && typeof from === "string") {
        const fromDate = new Date(from);
        if (!isNaN(fromDate.getTime())) {
          filtered = filtered.filter((r: any) => new Date(r.timestamp || r.createdAt) >= fromDate);
        }
      }

      if (to && typeof to === "string") {
        const toDate = new Date(to);
        if (!isNaN(toDate.getTime())) {
          filtered = filtered.filter((r: any) => new Date(r.timestamp || r.createdAt) <= toDate);
        }
      }

      if (type && typeof type === "string") {
        filtered = filtered.filter((r: any) => r.type === type);
      }

      // Summary stats
      const totalCost = filtered.reduce((sum: number, r: any) => sum + (r.totalEstimatedCost || 0), 0);
      const totalRecords = filtered.length;

      // Pagination
      const pageLimit = Math.min(parseInt(limit as string) || 100, 500);
      const pageOffset = parseInt(offset as string) || 0;
      const paginated = filtered.slice(pageOffset, pageOffset + pageLimit);

      res.json({
        records: paginated,
        pagination: {
          total: totalRecords,
          limit: pageLimit,
          offset: pageOffset,
          hasMore: pageOffset + pageLimit < totalRecords,
        },
        summary: {
          totalEstimatedCost: Math.round(totalCost * 100) / 100,
          recordCount: totalRecords,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching usage records");
      res.status(500).json({ message: "Failed to fetch usage records" });
    }
  });
}
