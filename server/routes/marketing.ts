/**
 * Marketing attribution routes — track where calls/interactions originate.
 *
 * Enables practices to measure ROI of marketing channels:
 * Google Ads, Yelp, referrals, walk-ins, etc.
 */
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole } from "../auth";
import { logger } from "../services/logger";
import type { MarketingSourceMetrics } from "@shared/schema";

export function registerMarketingRoutes(app: Express): void {

  // --- Marketing Campaigns ---

  app.get("/api/marketing/campaigns", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const { source, active } = req.query;
    const campaigns = await storage.listMarketingCampaigns(orgId, {
      source: source as string | undefined,
      isActive: active === "true" ? true : active === "false" ? false : undefined,
    });
    res.json(campaigns);
  });

  app.get("/api/marketing/campaigns/:id", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const campaign = await storage.getMarketingCampaign(orgId, req.params.id);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });

  app.post("/api/marketing/campaigns", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const { name, source, medium, startDate, endDate, budget, trackingCode, notes } = req.body;
    if (!name || !source) return res.status(400).json({ message: "name and source are required" });
    const campaign = await storage.createMarketingCampaign(orgId, {
      orgId, name, source, medium, startDate, endDate, budget, trackingCode, notes,
      isActive: true,
      createdBy: (req.user as any)?.name || "unknown",
    });
    res.status(201).json(campaign);
  });

  app.patch("/api/marketing/campaigns/:id", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const updated = await storage.updateMarketingCampaign(orgId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Campaign not found" });
    res.json(updated);
  });

  app.delete("/api/marketing/campaigns/:id", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    await storage.deleteMarketingCampaign(orgId, req.params.id);
    res.json({ message: "Campaign deleted" });
  });

  // --- Call Attribution ---

  app.get("/api/marketing/attribution/:callId", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const attr = await storage.getCallAttribution(orgId, req.params.callId);
    if (!attr) return res.status(404).json({ message: "No attribution found for this call" });
    res.json(attr);
  });

  app.put("/api/marketing/attribution/:callId", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    const callId = req.params.callId;
    const { source, campaignId, isNewPatient, referrerName, detectionMethod, confidence, notes } = req.body;
    if (!source) return res.status(400).json({ message: "source is required" });

    // Upsert: check if attribution exists
    const existing = await storage.getCallAttribution(orgId, callId);
    if (existing) {
      const updated = await storage.updateCallAttribution(orgId, callId, {
        source, campaignId, isNewPatient, referrerName, notes,
      });
      return res.json(updated);
    }

    const attr = await storage.createCallAttribution(orgId, {
      orgId, callId, source, campaignId, isNewPatient, referrerName,
      detectionMethod: detectionMethod || "manual",
      confidence: confidence || 1.0,
      notes,
      attributedBy: (req.user as any)?.name || "unknown",
    });
    res.status(201).json(attr);
  });

  app.delete("/api/marketing/attribution/:callId", requireAuth, requireRole("manager"), async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });
    await storage.deleteCallAttribution(orgId, req.params.callId);
    res.json({ message: "Attribution deleted" });
  });

  // --- Marketing Analytics ---

  /** GET /api/marketing/metrics — Aggregated metrics by source */
  app.get("/api/marketing/metrics", requireAuth, async (req: Request, res: Response) => {
    const orgId = req.orgId;
    if (!orgId) return res.status(403).json({ message: "Organization context required" });

    try {
      const attributions = await storage.listCallAttributions(orgId);
      const campaigns = await storage.listMarketingCampaigns(orgId);
      const revenues = await storage.listCallRevenues(orgId);

      // Build revenue lookup
      const revenueByCall = new Map<string, number>();
      for (const rev of revenues) {
        revenueByCall.set(rev.callId, rev.actualRevenue || rev.estimatedRevenue || 0);
      }

      // Build campaign budget lookup
      const budgetBySource = new Map<string, number>();
      for (const camp of campaigns) {
        if (camp.budget) {
          const current = budgetBySource.get(camp.source) || 0;
          budgetBySource.set(camp.source, current + camp.budget);
        }
      }

      // Load call scores
      const callScores = new Map<string, number>();
      for (const attr of attributions) {
        try {
          const analysis = await storage.getCallAnalysis(orgId, attr.callId);
          if (analysis?.performanceScore) {
            callScores.set(attr.callId, parseFloat(String(analysis.performanceScore)));
          }
        } catch { /* skip */ }
      }

      // Aggregate by source
      const sourceMap = new Map<string, {
        calls: number; newPatients: number; converted: number;
        revenue: number; scores: number[];
      }>();

      for (const attr of attributions) {
        if (!sourceMap.has(attr.source)) {
          sourceMap.set(attr.source, { calls: 0, newPatients: 0, converted: 0, revenue: 0, scores: [] });
        }
        const entry = sourceMap.get(attr.source)!;
        entry.calls++;
        if (attr.isNewPatient) entry.newPatients++;
        const rev = revenueByCall.get(attr.callId) || 0;
        if (rev > 0) { entry.converted++; entry.revenue += rev; }
        const score = callScores.get(attr.callId);
        if (score) entry.scores.push(score);
      }

      const metrics: MarketingSourceMetrics[] = Array.from(sourceMap.entries()).map(([source, data]) => {
        const budget = budgetBySource.get(source);
        return {
          source,
          totalCalls: data.calls,
          newPatients: data.newPatients,
          convertedCalls: data.converted,
          totalRevenue: Math.round(data.revenue * 100) / 100,
          avgPerformanceScore: data.scores.length > 0
            ? Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 10) / 10
            : 0,
          costPerLead: budget ? Math.round((budget / data.calls) * 100) / 100 : null,
          roi: budget && data.revenue > 0
            ? Math.round(((data.revenue - budget) / budget) * 100) / 100
            : null,
        };
      });

      // Sort by total calls descending
      metrics.sort((a, b) => b.totalCalls - a.totalCalls);

      res.json({
        sources: metrics,
        totalAttributed: attributions.length,
        totalNewPatients: attributions.filter(a => a.isNewPatient).length,
        totalRevenue: Math.round(Array.from(sourceMap.values()).reduce((sum, d) => sum + d.revenue, 0) * 100) / 100,
        totalBudget: Math.round(Array.from(budgetBySource.values()).reduce((sum, b) => sum + b, 0) * 100) / 100,
        activeCampaigns: campaigns.filter(c => c.isActive).length,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to compute marketing metrics");
      res.status(500).json({ message: "Failed to compute marketing metrics" });
    }
  });

  /** GET /api/marketing/sources — List available marketing source types */
  app.get("/api/marketing/sources", requireAuth, (_req: Request, res: Response) => {
    const { MARKETING_SOURCES } = require("@shared/schema");
    res.json(MARKETING_SOURCES);
  });
}
