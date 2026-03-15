/**
 * Proactive Alerts — Detects metric shifts and generates notifications.
 *
 * Runs after each call analysis to check if coaching recommendations
 * should be generated, and provides weekly digest generation.
 */
import { storage } from "../storage";
import { logger } from "./logger";
import { generateRecommendations, saveRecommendations } from "./coaching-engine";
import { sendSlackNotification, type SlackNotificationPayload } from "./notifications";
import type { CallSummary, Employee } from "@shared/schema";

/**
 * Auto-check coaching recommendations after a call completes analysis.
 * Non-blocking — failures are logged but never throw.
 */
export async function onCallAnalysisComplete(
  orgId: string,
  callId: string,
  employeeId?: string,
): Promise<void> {
  if (!employeeId) return;

  try {
    const recs = await generateRecommendations(orgId, employeeId);
    if (recs.length > 0) {
      const saved = await saveRecommendations(orgId, recs);
      if (saved > 0) {
        logger.info(
          { orgId, employeeId, callId, newRecommendations: saved },
          "Auto-generated coaching recommendations after call analysis",
        );

        // Send Slack/Teams notification for high-severity recommendations
        const highSeverity = recs.filter(r => r.severity === "high");
        if (highSeverity.length > 0) {
          const employee = await storage.getEmployee(orgId, employeeId);
          sendCoachingAlert(orgId, employee, highSeverity).catch(() => {});
        }
      }
    }
  } catch (error) {
    logger.warn({ err: error, orgId, callId, employeeId }, "Failed to auto-generate coaching recommendations");
  }
}

/**
 * Generate a manager review queue — agents prioritized by who needs attention most.
 */
export async function getManagerReviewQueue(
  orgId: string,
): Promise<AgentPriority[]> {
  const employees = await storage.getAllEmployees(orgId);
  const activeEmployees = employees.filter((e: Employee) => e.status === "Active");

  const priorities: AgentPriority[] = [];

  for (const emp of activeEmployees) {
    const calls = await storage.getCallSummaries(orgId, { employee: emp.id, status: "completed" });
    const scored = calls
      .filter(c => c.analysis?.performanceScore != null)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

    if (scored.length === 0) continue;

    const recent = scored.slice(0, 10);
    const scores = recent.map(c => Number(c.analysis?.performanceScore) || 0);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Calculate trend (slope of last N scores)
    const trend = scores.length >= 3 ? calculateTrend(scores) : 0;

    // Count flags
    const flagCount = recent.reduce((sum, c) => {
      const flags = c.analysis?.flags;
      return sum + (Array.isArray(flags) ? flags.length : 0);
    }, 0);

    // Priority score: lower avg = higher priority, declining trend = higher priority, more flags = higher priority
    const priorityScore = (10 - avgScore) * 3 + Math.max(0, -trend) * 5 + flagCount * 2;

    // Days since last coaching
    const coachingSessions = await storage.getCoachingSessionsByEmployee(orgId, emp.id);
    const lastCoaching = coachingSessions
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
    const daysSinceCoaching = lastCoaching?.createdAt
      ? Math.floor((Date.now() - new Date(lastCoaching.createdAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    priorities.push({
      employeeId: emp.id,
      employeeName: emp.name,
      avgScore: Math.round(avgScore * 10) / 10,
      trend: Math.round(trend * 100) / 100,
      trendLabel: trend > 0.2 ? "improving" : trend < -0.2 ? "declining" : "stable",
      recentCallCount: recent.length,
      flagCount,
      priorityScore: Math.round(priorityScore * 10) / 10,
      daysSinceCoaching,
      needsAttention: avgScore < 5 || trend < -0.3 || flagCount >= 3,
    });
  }

  return priorities.sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Generate a weekly digest summary for the org.
 */
export async function generateWeeklyDigest(orgId: string): Promise<WeeklyDigest> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const allCalls = await storage.getCallSummaries(orgId, { status: "completed" });
  const thisWeek = allCalls.filter(c => c.uploadedAt && new Date(c.uploadedAt) >= weekAgo);
  const scored = thisWeek.filter(c => c.analysis?.performanceScore != null);

  const totalCalls = thisWeek.length;
  const avgScore = scored.length > 0
    ? scored.reduce((sum, c) => sum + (Number(c.analysis?.performanceScore) || 0), 0) / scored.length
    : 0;

  // Flagged calls
  const flagged = thisWeek.filter(c => {
    const flags = c.analysis?.flags;
    return Array.isArray(flags) && flags.length > 0;
  });

  // Sentiment breakdown
  const sentiments = { positive: 0, neutral: 0, negative: 0 };
  for (const c of thisWeek) {
    const s = c.sentiment?.overallSentiment;
    if (s === "positive") sentiments.positive++;
    else if (s === "negative") sentiments.negative++;
    else sentiments.neutral++;
  }

  // Top / bottom performers
  const employeeScores: Record<string, { name: string; scores: number[] }> = {};
  for (const c of scored) {
    const empId = c.employeeId || "unassigned";
    if (!employeeScores[empId]) {
      employeeScores[empId] = { name: c.employee?.name || "Unassigned", scores: [] };
    }
    employeeScores[empId].scores.push(Number(c.analysis?.performanceScore) || 0);
  }

  const employeeAvgs = Object.entries(employeeScores)
    .map(([id, { name, scores }]) => ({
      employeeId: id,
      name,
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      callCount: scores.length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  // Review queue
  const reviewQueue = await getManagerReviewQueue(orgId);
  const needsAttention = reviewQueue.filter(a => a.needsAttention);

  return {
    period: { from: weekAgo.toISOString(), to: now.toISOString() },
    totalCalls,
    avgScore: Math.round(avgScore * 10) / 10,
    flaggedCalls: flagged.length,
    sentiment: sentiments,
    topPerformers: employeeAvgs.slice(0, 3),
    bottomPerformers: employeeAvgs.slice(-3).reverse(),
    agentsNeedingAttention: needsAttention.slice(0, 5).map(a => ({
      name: a.employeeName,
      avgScore: a.avgScore,
      trend: a.trendLabel,
      reason: a.avgScore < 5 ? "Low score" : a.flagCount >= 3 ? "Recurring flags" : "Declining trend",
    })),
  };
}

// --- Internal helpers ---

function calculateTrend(scores: number[]): number {
  // Simple linear regression slope (normalized)
  const n = scores.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope; // positive = improving over time (index 0 = most recent)
}

async function sendCoachingAlert(
  orgId: string,
  employee: Employee | undefined,
  recommendations: Array<{ title: string; severity: string; trigger: string }>,
): Promise<void> {
  const payload: SlackNotificationPayload = {
    channel: "coaching",
    text: `Coaching alert: ${recommendations.length} high-priority recommendation(s) for ${employee?.name || "an agent"}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: ":rotating_light: Coaching Recommendations", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${employee?.name || "Agent"}* has ${recommendations.length} new high-priority coaching recommendation(s):`,
        },
      },
      ...recommendations.slice(0, 5).map(r => ({
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `• *${r.title}*` },
      })),
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Organization: ${orgId} | Generated: ${new Date().toLocaleString()}` },
        ],
      },
    ],
  };

  await sendSlackNotification(payload);
}

// --- Types ---

export interface AgentPriority {
  employeeId: string;
  employeeName: string;
  avgScore: number;
  trend: number;
  trendLabel: "improving" | "declining" | "stable";
  recentCallCount: number;
  flagCount: number;
  priorityScore: number;
  daysSinceCoaching: number | null;
  needsAttention: boolean;
}

export interface WeeklyDigest {
  period: { from: string; to: string };
  totalCalls: number;
  avgScore: number;
  flaggedCalls: number;
  sentiment: { positive: number; neutral: number; negative: number };
  topPerformers: Array<{ employeeId: string; name: string; avgScore: number; callCount: number }>;
  bottomPerformers: Array<{ employeeId: string; name: string; avgScore: number; callCount: number }>;
  agentsNeedingAttention: Array<{ name: string; avgScore: number; trend: string; reason: string }>;
}
