import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";

export function registerRevenueRoutes(app: Express) {
  // Get revenue metrics summary
  app.get("/api/revenue/metrics", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const metrics = await storage.getRevenueMetrics(orgId);
      res.json(metrics);
    } catch (error) {
      logger.error({ err: error }, "Failed to get revenue metrics");
      res.status(500).json({ message: "Failed to get revenue metrics" });
    }
  });

  // List all call revenue records
  app.get("/api/revenue", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { conversionStatus } = req.query;
      const revenues = await storage.listCallRevenues(orgId, {
        conversionStatus: conversionStatus as string | undefined,
      });

      // Enrich with call details
      const enriched = await Promise.all(revenues.map(async (rev) => {
        const call = await storage.getCall(orgId, rev.callId);
        const employee = call?.employeeId ? await storage.getEmployee(orgId, call.employeeId) : undefined;
        return {
          ...rev,
          callFileName: call?.fileName,
          callCategory: call?.callCategory,
          employeeName: employee?.name,
          callDate: call?.uploadedAt,
        };
      }));

      res.json(enriched);
    } catch (error) {
      logger.error({ err: error }, "Failed to list revenue records");
      res.status(500).json({ message: "Failed to list revenue records" });
    }
  });

  // Get revenue for a specific call
  app.get("/api/revenue/call/:callId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenue = await storage.getCallRevenue(orgId, req.params.callId);
      if (!revenue) return res.status(404).json({ message: "Revenue record not found" });
      res.json(revenue);
    } catch (error) {
      logger.error({ err: error }, "Failed to get call revenue");
      res.status(500).json({ message: "Failed to get call revenue" });
    }
  });

  // Create or update revenue for a call
  app.put("/api/revenue/call/:callId", requireAuth, requireRole("manager"), injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { callId } = req.params;
      const call = await storage.getCall(orgId, callId);
      if (!call) return res.status(404).json({ message: "Call not found" });

      const existing = await storage.getCallRevenue(orgId, callId);
      if (existing) {
        const updated = await storage.updateCallRevenue(orgId, callId, {
          ...req.body,
          updatedBy: req.user!.name || req.user!.username,
        });
        res.json(updated);
      } else {
        const revenue = await storage.createCallRevenue(orgId, {
          orgId,
          callId,
          ...req.body,
          updatedBy: req.user!.name || req.user!.username,
        });
        res.json(revenue);
      }

      logger.info({ orgId, callId }, "Call revenue updated");
    } catch (error) {
      logger.error({ err: error }, "Failed to update call revenue");
      res.status(500).json({ message: "Failed to update call revenue" });
    }
  });

  // Get revenue by employee (aggregated)
  app.get("/api/revenue/by-employee", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const revenues = await storage.listCallRevenues(orgId);
      const calls = await storage.getAllCalls(orgId);
      const employees = await storage.getAllEmployees(orgId);

      const callMap = new Map(calls.map(c => [c.id, c]));
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      const byEmployee: Record<string, {
        employeeId: string;
        employeeName: string;
        totalEstimated: number;
        totalActual: number;
        callCount: number;
        converted: number;
      }> = {};

      for (const rev of revenues) {
        const call = callMap.get(rev.callId);
        if (!call?.employeeId) continue;
        const emp = employeeMap.get(call.employeeId);
        if (!emp) continue;

        if (!byEmployee[emp.id]) {
          byEmployee[emp.id] = {
            employeeId: emp.id,
            employeeName: emp.name,
            totalEstimated: 0,
            totalActual: 0,
            callCount: 0,
            converted: 0,
          };
        }

        byEmployee[emp.id].totalEstimated += rev.estimatedRevenue || 0;
        byEmployee[emp.id].totalActual += rev.actualRevenue || 0;
        byEmployee[emp.id].callCount++;
        if (rev.conversionStatus === "converted") byEmployee[emp.id].converted++;
      }

      const result = Object.values(byEmployee).sort((a, b) => b.totalActual - a.totalActual);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Failed to get revenue by employee");
      res.status(500).json({ message: "Failed to get revenue by employee" });
    }
  });
}
