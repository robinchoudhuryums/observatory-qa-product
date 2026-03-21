import type { Express } from "express";
import { storage } from "../storage";
import { aiProvider } from "../services/ai-factory";
import { getRedis } from "../services/redis";

export function registerHealthRoutes(app: Express): void {
  // ==================== HEALTH CHECK (unauthenticated) ====================
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { status: string; detail?: string }> = {};
    let overall = true;

    // Check storage connectivity
    try {
      const orgs = await storage.listOrganizations();
      checks.storage = { status: "ok", detail: `${orgs.length} org(s)` };
    } catch (error) {
      checks.storage = { status: "error", detail: (error as Error).message };
      overall = false;
    }

    // Check Redis connectivity
    const redis = getRedis();
    if (redis) {
      try {
        await redis.ping();
        checks.redis = { status: "ok" };
      } catch (error) {
        checks.redis = { status: "error", detail: (error as Error).message };
        overall = false;
      }
    } else {
      checks.redis = { status: "unavailable", detail: "No REDIS_URL configured" };
    }

    // Check AI provider availability
    checks.ai = {
      status: aiProvider.isAvailable ? "ok" : "unavailable",
      detail: aiProvider.name,
    };

    // Check AssemblyAI configuration
    checks.transcription = {
      status: process.env.ASSEMBLYAI_API_KEY ? "ok" : "unconfigured",
    };

    // Memory usage
    const mem = process.memoryUsage();
    checks.memory = {
      status: mem.heapUsed / mem.heapTotal > 0.9 ? "warning" : "ok",
      detail: `${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB heap`,
    };

    res.status(overall ? 200 : 503).json({
      status: overall ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "unknown",
      checks,
      uptime: Math.floor(process.uptime()),
    });
  });
}
