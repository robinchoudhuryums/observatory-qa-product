import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { safeInt } from "./helpers";
import { getRedis } from "../services/redis";

const DASHBOARD_CACHE_TTL = 60; // 60 seconds

/** Cache-through helper: returns cached JSON if available, otherwise calls fn and caches result */
async function withCache<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch { /* Redis unavailable — fall through */ }
  }

  const result = await fn();

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", ttlSeconds);
    } catch { /* Redis unavailable — skip caching */ }
  }

  return result;
}

export function registerDashboardRoutes(app: Express): void {
  // Usage analytics (admin only)
  app.get("/api/dashboard/usage", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { start, end } = req.query;
      const startDate = start ? new Date(start as string) : undefined;
      const endDate = end ? new Date(end as string) : undefined;
      const summary = await storage.getUsageSummary(req.orgId!, startDate, endDate);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ message: "Failed to get usage data" });
    }
  });

  // Dashboard metrics (cached 60s per org)
  app.get("/api/dashboard/metrics", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const metrics = await withCache(
        `dashboard:metrics:${req.orgId}`,
        DASHBOARD_CACHE_TTL,
        () => storage.getDashboardMetrics(req.orgId!),
      );
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ message: "Failed to get dashboard metrics" });
    }
  });

  // Sentiment distribution (cached 60s per org)
  app.get("/api/dashboard/sentiment", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const distribution = await withCache(
        `dashboard:sentiment:${req.orgId}`,
        DASHBOARD_CACHE_TTL,
        () => storage.getSentimentDistribution(req.orgId!),
      );
      res.json(distribution);
    } catch (error) {
      res.status(500).json({ message: "Failed to get sentiment distribution" });
    }
  });

  // Top performers (cached 60s per org)
  app.get("/api/dashboard/performers", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const limit = Math.min(safeInt(req.query.limit, 3), 100);
      const performers = await withCache(
        `dashboard:performers:${req.orgId}:${limit}`,
        DASHBOARD_CACHE_TTL,
        () => storage.getTopPerformers(req.orgId!, limit),
      );
      res.json(performers);
    } catch (error) {
      res.status(500).json({ message: "Failed to get top performers" });
    }
  });
}
