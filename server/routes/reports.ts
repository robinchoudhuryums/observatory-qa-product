import type { Express } from "express";
import { storage } from "../storage";
import { aiProvider } from "../services/ai-factory";
import { buildAgentSummaryPrompt } from "../services/ai-provider";
import { requireAuth, injectOrgContext } from "../auth";
import { safeFloat } from "./helpers";
import { logger } from "../services/logger";
import { logPhiAccess, auditContext } from "../services/audit-log";

function safeJsonParse<T>(val: unknown, fallback: T): T {
  if (typeof val !== 'string') return (val as T) ?? fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export function registerReportRoutes(app: Express): void {

  // Search calls
  app.get("/api/search", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ message: "Search query is required" });
        return;
      }

      const results = await storage.searchCalls(req.orgId!, query);
      logPhiAccess({
        ...auditContext(req),
        event: "search_calls",
        resourceType: "call",
        detail: `Search returned ${results.length} results`,
      });
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to search calls" });
    }
  });

  // This new route will handle requests for the Performance page
  app.get("/api/performance", requireAuth, injectOrgContext, async (req, res) => {
    try {
      // We can reuse the existing function to get top performers
      const performers = await storage.getTopPerformers(req.orgId!, 10); // Get top 10
      res.json(performers);
    } catch (error) {
      logger.error({ err: error }, "Failed to get performance data");
      res.status(500).json({ message: "Failed to get performance data" });
    }
  });

  app.get("/api/reports/summary", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const [metrics, sentiment, performers] = await Promise.all([
        storage.getDashboardMetrics(req.orgId!),
        storage.getSentimentDistribution(req.orgId!),
        storage.getTopPerformers(req.orgId!, 5),
      ]);

      const reportData = {
        metrics,
        sentiment,
        performers,
      };

      res.json(reportData);
    } catch (error) {
      logger.error({ err: error }, "Failed to generate report data");
      res.status(500).json({ message: "Failed to generate report data" });
    }
  });

  // Filtered reports: accepts date range, employee, department filters
  app.get("/api/reports/filtered", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { from, to, employeeId, department, callPartyType } = req.query;

      const allCalls = await storage.getCallSummaries(req.orgId!, { status: "completed" });
      const employees = await storage.getAllEmployees(req.orgId!);

      // Build employee lookup maps
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      // Filter by date range
      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      // Filter by employee
      if (employeeId) {
        filtered = filtered.filter(c => c.employeeId === employeeId);
      }

      // Filter by department
      if (department) {
        filtered = filtered.filter(c => {
          if (!c.employeeId) return false;
          const emp = employeeMap.get(c.employeeId);
          return emp?.role === department;
        });
      }

      // Filter by call party type
      if (callPartyType) {
        filtered = filtered.filter(c => {
          const partyType = (c.analysis as any)?.callPartyType;
          return partyType === callPartyType;
        });
      }

      // Compute metrics from filtered set
      const totalCalls = filtered.length;
      const sentiments = filtered.map(c => c.sentiment).filter(Boolean);
      const analyses = filtered.map(c => c.analysis).filter(Boolean);

      const avgSentiment = sentiments.length > 0
        ? (sentiments.reduce((sum, s) => sum + safeFloat(s!.overallScore), 0) / sentiments.length) * 10
        : 0;
      const avgPerformanceScore = analyses.length > 0
        ? analyses.reduce((sum, a) => sum + safeFloat(a!.performanceScore), 0) / analyses.length
        : 0;

      const sentimentDist = { positive: 0, neutral: 0, negative: 0 };
      for (const s of sentiments) {
        const key = s!.overallSentiment as keyof typeof sentimentDist;
        if (key in sentimentDist) sentimentDist[key]++;
      }

      // Per-employee stats for performers list
      const employeeStats = new Map<string, { totalScore: number; callCount: number }>();
      for (const call of filtered) {
        if (!call.employeeId) continue;
        const stats = employeeStats.get(call.employeeId) || { totalScore: 0, callCount: 0 };
        stats.callCount++;
        if (call.analysis?.performanceScore) {
          stats.totalScore += safeFloat(call.analysis.performanceScore);
        }
        employeeStats.set(call.employeeId, stats);
      }

      const performers = Array.from(employeeStats.entries())
        .map(([empId, stats]) => {
          const emp = employeeMap.get(empId);
          return {
            id: empId,
            name: emp?.name || "Unknown",
            role: emp?.role || "",
            avgPerformanceScore: stats.callCount > 0
              ? Math.round((stats.totalScore / stats.callCount) * 100) / 100
              : null,
            totalCalls: stats.callCount,
          };
        })
        .filter(p => p.totalCalls > 0)
        .sort((a, b) => (b.avgPerformanceScore || 0) - (a.avgPerformanceScore || 0));

      // Trend data: group by month
      const trendMap = new Map<string, { calls: number; totalScore: number; scored: number; positive: number; neutral: number; negative: number }>();
      for (const call of filtered) {
        const date = new Date(call.uploadedAt || 0);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        const entry = trendMap.get(monthKey) || { calls: 0, totalScore: 0, scored: 0, positive: 0, neutral: 0, negative: 0 };
        entry.calls++;
        if (call.analysis?.performanceScore) {
          entry.totalScore += safeFloat(call.analysis.performanceScore);
          entry.scored++;
        }
        if (call.sentiment?.overallSentiment) {
          const sent = call.sentiment.overallSentiment as "positive" | "neutral" | "negative";
          if (sent in entry) entry[sent]++;
        }
        trendMap.set(monthKey, entry);
      }

      const trends = Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          calls: data.calls,
          avgScore: data.scored > 0 ? Math.round((data.totalScore / data.scored) * 100) / 100 : null,
          positive: data.positive,
          neutral: data.neutral,
          negative: data.negative,
        }));

      // Aggregate sub-scores across all analyzed calls
      const subScoreTotals = { compliance: 0, customerExperience: 0, communication: 0, resolution: 0, count: 0 };
      for (const call of filtered) {
        const ss = (call.analysis as any)?.subScores;
        if (ss && (ss.compliance || ss.customerExperience || ss.communication || ss.resolution)) {
          subScoreTotals.compliance += ss.compliance || 0;
          subScoreTotals.customerExperience += ss.customerExperience || 0;
          subScoreTotals.communication += ss.communication || 0;
          subScoreTotals.resolution += ss.resolution || 0;
          subScoreTotals.count++;
        }
      }

      const avgSubScores = subScoreTotals.count > 0 ? {
        compliance: Math.round((subScoreTotals.compliance / subScoreTotals.count) * 100) / 100,
        customerExperience: Math.round((subScoreTotals.customerExperience / subScoreTotals.count) * 100) / 100,
        communication: Math.round((subScoreTotals.communication / subScoreTotals.count) * 100) / 100,
        resolution: Math.round((subScoreTotals.resolution / subScoreTotals.count) * 100) / 100,
      } : null;

      // Count auto-assigned calls
      const autoAssignedCount = filtered.filter(c => (c.analysis as any)?.detectedAgentName).length;

      res.json({
        metrics: {
          totalCalls,
          avgSentiment: Math.round(avgSentiment * 100) / 100,
          avgPerformanceScore: Math.round(avgPerformanceScore * 100) / 100,
        },
        sentiment: sentimentDist,
        performers,
        trends,
        avgSubScores,
        autoAssignedCount,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate filtered report");
      res.status(500).json({ message: "Failed to generate filtered report" });
    }
  });

  // Comparative analytics: compare two time periods side by side
  app.get("/api/reports/compare", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { currentFrom, currentTo, previousFrom, previousTo } = req.query;
      if (!currentFrom || !currentTo || !previousFrom || !previousTo) {
        res.status(400).json({ message: "Required query params: currentFrom, currentTo, previousFrom, previousTo" });
        return;
      }

      const allCalls = await storage.getCallSummaries(req.orgId!, { status: "completed" });

      const computePeriodMetrics = (calls: typeof allCalls, from: string, to: string) => {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);

        const filtered = calls.filter(c => {
          const d = new Date(c.uploadedAt || 0);
          return d >= fromDate && d <= toDate;
        });

        const scores = filtered
          .map(c => c.analysis?.performanceScore ? safeFloat(c.analysis.performanceScore) : null)
          .filter((s): s is number => s !== null);

        const sentiments = { positive: 0, neutral: 0, negative: 0 };
        for (const c of filtered) {
          const s = c.sentiment?.overallSentiment as keyof typeof sentiments;
          if (s && s in sentiments) sentiments[s]++;
        }

        return {
          totalCalls: filtered.length,
          avgScore: scores.length > 0
            ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
            : null,
          sentiments,
          flaggedCount: filtered.filter(c => {
            const flags = c.analysis?.flags;
            return Array.isArray(flags) && flags.length > 0;
          }).length,
        };
      };

      const current = computePeriodMetrics(allCalls, currentFrom as string, currentTo as string);
      const previous = computePeriodMetrics(allCalls, previousFrom as string, previousTo as string);

      // Compute deltas
      const delta = {
        totalCalls: current.totalCalls - previous.totalCalls,
        avgScore: current.avgScore != null && previous.avgScore != null
          ? Math.round((current.avgScore - previous.avgScore) * 100) / 100
          : null,
        flaggedCount: current.flaggedCount - previous.flaggedCount,
      };

      res.json({ current, previous, delta });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate comparative report");
      res.status(500).json({ message: "Failed to generate comparative report" });
    }
  });

  // Agent profile: aggregated feedback across all calls for an employee
  app.get("/api/reports/agent-profile/:employeeId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const { from, to } = req.query;

      const employee = await storage.getEmployee(req.orgId!, employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const allCalls = await storage.getCallSummaries(req.orgId!, { status: "completed", employee: employeeId });

      // Apply optional date filters
      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from as string);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      // Aggregate all analysis feedback
      const allStrengths: string[] = [];
      const allSuggestions: string[] = [];
      const allTopics: string[] = [];
      const scores: number[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

      // Flagged calls (exceptional and problematic)
      const flaggedCalls: Array<{
        id: string;
        fileName?: string;
        uploadedAt?: string;
        score: number | null;
        summary?: string;
        flags: string[];
        sentiment?: string;
        flagType: "good" | "bad";
      }> = [];

      // Trend over time for this agent
      const monthlyScores = new Map<string, { total: number; count: number }>();

      for (const call of filtered) {
        if (call.analysis) {
          if (call.analysis.performanceScore) {
            scores.push(safeFloat(call.analysis.performanceScore));
          }
          if (call.analysis.feedback) {
            const fb = safeJsonParse(call.analysis.feedback, {} as Record<string, any>);
            if (fb.strengths) {
              for (const s of fb.strengths) {
                allStrengths.push(typeof s === "string" ? s : s.text);
              }
            }
            if (fb.suggestions) {
              for (const s of fb.suggestions) {
                allSuggestions.push(typeof s === "string" ? s : s.text);
              }
            }
          }
          if (call.analysis.topics) {
            const topics = safeJsonParse(call.analysis.topics, [] as string[]);
            if (Array.isArray(topics)) allTopics.push(...topics);
          }

          // Collect flagged calls
          const callFlags = Array.isArray(call.analysis.flags) ? call.analysis.flags as string[] : [];
          const isExceptional = callFlags.includes("exceptional_call");
          const isBad = callFlags.includes("low_score") || callFlags.some((f: string) => f.startsWith("agent_misconduct"));
          if (isExceptional || isBad) {
            flaggedCalls.push({
              id: call.id,
              fileName: call.fileName,
              uploadedAt: call.uploadedAt,
              score: call.analysis.performanceScore ? safeFloat(call.analysis.performanceScore) : null,
              summary: call.analysis.summary,
              flags: callFlags,
              sentiment: call.sentiment?.overallSentiment,
              flagType: isExceptional ? "good" : "bad",
            });
          }
        }
        if (call.sentiment?.overallSentiment) {
          const s = call.sentiment.overallSentiment as keyof typeof sentimentCounts;
          if (s in sentimentCounts) sentimentCounts[s]++;
        }

        // Monthly trend
        const date = new Date(call.uploadedAt || 0);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (call.analysis?.performanceScore) {
          const entry = monthlyScores.get(monthKey) || { total: 0, count: 0 };
          entry.total += safeFloat(call.analysis.performanceScore);
          entry.count++;
          monthlyScores.set(monthKey, entry);
        }
      }

      // Count frequency of strengths, suggestions, topics
      const countFrequency = (arr: string[]) => {
        const freq = new Map<string, number>();
        for (const item of arr) {
          const normalized = item.trim().toLowerCase();
          freq.set(normalized, (freq.get(normalized) || 0) + 1);
        }
        return Array.from(freq.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([text, count]) => ({ text, count }));
      };

      const avgScore = scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : null;
      const highScore = scores.length > 0 ? Math.max(...scores) : null;
      const lowScore = scores.length > 0 ? Math.min(...scores) : null;

      const scoreTrend = Array.from(monthlyScores.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, data]) => ({
          month,
          avgScore: Math.round((data.total / data.count) * 100) / 100,
          calls: data.count,
        }));

      logPhiAccess({
        ...auditContext(req),
        event: "view_agent_profile",
        resourceType: "employee",
        resourceId: employeeId,
        detail: `${filtered.length} calls analyzed`,
      });

      res.json({
        employee: { id: employee.id, name: employee.name, role: employee.role, status: employee.status },
        totalCalls: filtered.length,
        avgPerformanceScore: avgScore,
        highScore,
        lowScore,
        sentimentBreakdown: sentimentCounts,
        topStrengths: countFrequency(allStrengths),
        topSuggestions: countFrequency(allSuggestions),
        commonTopics: countFrequency(allTopics),
        scoreTrend,
        flaggedCalls: flaggedCalls.sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate agent profile");
      res.status(500).json({ message: "Failed to generate agent profile" });
    }
  });

  // Generate AI narrative summary for an agent's performance
  app.post("/api/reports/agent-summary/:employeeId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      if (!aiProvider.isAvailable || !aiProvider.generateText) {
        res.status(503).json({ message: "AI provider not configured. Set up Bedrock or Gemini credentials." });
        return;
      }

      const { employeeId } = req.params;
      const { from, to } = req.body;

      const employee = await storage.getEmployee(req.orgId!, employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const allCalls = await storage.getCallSummaries(req.orgId!, { status: "completed", employee: employeeId });

      let filtered = allCalls;
      if (from) {
        const fromDate = new Date(from);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) >= fromDate);
      }
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filtered = filtered.filter(c => new Date(c.uploadedAt || 0) <= toDate);
      }

      if (filtered.length === 0) {
        res.json({ summary: "No analyzed calls found for this employee in the selected period." });
        return;
      }

      // Aggregate data
      const scores: number[] = [];
      const allStrengths: string[] = [];
      const allSuggestions: string[] = [];
      const allTopics: string[] = [];
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

      for (const call of filtered) {
        if (call.analysis?.performanceScore) {
          scores.push(safeFloat(call.analysis.performanceScore));
        }
        if (call.analysis?.feedback) {
          const fb = safeJsonParse(call.analysis.feedback, {} as Record<string, any>);
          if (fb.strengths) {
            for (const s of fb.strengths) {
              allStrengths.push(typeof s === "string" ? s : s.text);
            }
          }
          if (fb.suggestions) {
            for (const s of fb.suggestions) {
              allSuggestions.push(typeof s === "string" ? s : s.text);
            }
          }
        }
        if (call.analysis?.topics) {
          const topics = safeJsonParse(call.analysis.topics, [] as string[]);
          if (Array.isArray(topics)) allTopics.push(...topics);
        }
        if (call.sentiment?.overallSentiment) {
          const s = call.sentiment.overallSentiment as keyof typeof sentimentCounts;
          if (s in sentimentCounts) sentimentCounts[s]++;
        }
      }

      const countFreq = (arr: string[]) => {
        const freq = new Map<string, number>();
        for (const item of arr) {
          const n = item.trim().toLowerCase();
          freq.set(n, (freq.get(n) || 0) + 1);
        }
        return Array.from(freq.entries())
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([text, count]) => ({ text, count }));
      };

      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

      // Sanitize date inputs to prevent prompt injection
      const sanitizeDate = (d: string | undefined): string => {
        if (!d) return "";
        return d.replace(/[^0-9\-\/T:Z ]/g, "").slice(0, 30);
      };
      const dateRange = `${sanitizeDate(from as string) || "all time"} to ${sanitizeDate(to as string) || "present"}`;

      const prompt = buildAgentSummaryPrompt({
        name: employee.name,
        role: employee.role,
        totalCalls: filtered.length,
        avgScore,
        highScore: scores.length > 0 ? Math.max(...scores) : null,
        lowScore: scores.length > 0 ? Math.min(...scores) : null,
        sentimentBreakdown: sentimentCounts,
        topStrengths: countFreq(allStrengths),
        topSuggestions: countFreq(allSuggestions),
        commonTopics: countFreq(allTopics),
        dateRange,
      });

      logger.info({ employeeId: req.params.employeeId, callCount: filtered.length }, "Generating AI summary");
      const summary = await aiProvider.generateText(prompt);
      logger.info({ employeeId: req.params.employeeId }, "AI summary generated");

      res.json({ summary });
    } catch (error) {
      logger.error({ err: error }, "Failed to generate agent summary");
      res.status(500).json({ message: "Failed to generate AI summary" });
    }
  });

  // Export agent profile report as printable HTML (for PDF via browser print)
  app.get("/api/reports/agent-profile/:employeeId/export", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const employee = await storage.getEmployee(req.orgId!, employeeId);
      if (!employee) {
        res.status(404).json({ message: "Employee not found" });
        return;
      }

      const allCalls = await storage.getCallSummaries(req.orgId!, { status: "completed", employee: employeeId });
      const scores = allCalls
        .map(c => c.analysis?.performanceScore ? safeFloat(c.analysis.performanceScore) : null)
        .filter((s): s is number => s !== null);

      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
      for (const c of allCalls) {
        const s = c.sentiment?.overallSentiment as keyof typeof sentimentCounts;
        if (s && s in sentimentCounts) sentimentCounts[s]++;
      }

      const avgScore = scores.length > 0
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        : "N/A";

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Agent Report - ${employee.name}</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 2em auto; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 0.3em; }
  .meta { color: #666; margin-bottom: 2em; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em; margin: 1.5em 0; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1em; text-align: center; }
  .card .value { font-size: 2em; font-weight: bold; }
  .card .label { color: #666; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 0.5em; text-align: left; }
  th { background: #f5f5f5; }
  @media print { body { margin: 0; } }
</style></head><body>
<h1>Agent Performance Report</h1>
<div class="meta">
  <strong>${employee.name}</strong> &mdash; ${employee.role || "N/A"}<br>
  Generated: ${new Date().toLocaleDateString()}<br>
  Total Calls Analyzed: ${allCalls.length}
</div>
<div class="grid">
  <div class="card"><div class="value">${avgScore}</div><div class="label">Avg Score</div></div>
  <div class="card"><div class="value">${allCalls.length}</div><div class="label">Total Calls</div></div>
  <div class="card"><div class="value">${sentimentCounts.positive}</div><div class="label">Positive</div></div>
</div>
<h2>Sentiment Breakdown</h2>
<table>
  <tr><th>Sentiment</th><th>Count</th><th>%</th></tr>
  ${(["positive", "neutral", "negative"] as const).map(s =>
    `<tr><td>${s}</td><td>${sentimentCounts[s]}</td><td>${allCalls.length > 0 ? ((sentimentCounts[s] / allCalls.length) * 100).toFixed(0) : 0}%</td></tr>`
  ).join("")}
</table>
<h2>Recent Calls</h2>
<table>
  <tr><th>Date</th><th>File</th><th>Score</th><th>Sentiment</th></tr>
  ${allCalls.slice(0, 20).map(c => `<tr>
    <td>${c.uploadedAt ? new Date(c.uploadedAt).toLocaleDateString() : "—"}</td>
    <td>${c.fileName || "—"}</td>
    <td>${c.analysis?.performanceScore || "—"}</td>
    <td>${c.sentiment?.overallSentiment || "—"}</td>
  </tr>`).join("")}
</table>
</body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (error) {
      logger.error({ err: error }, "Failed to export agent report");
      res.status(500).json({ message: "Failed to export agent report" });
    }
  });
}
