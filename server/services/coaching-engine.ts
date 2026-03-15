/**
 * Coaching Engine — Auto-recommendation and AI plan generation.
 *
 * Analyzes agent performance patterns and generates coaching recommendations
 * when metrics drop below thresholds. Also generates AI coaching plans.
 */
import { randomUUID } from "crypto";
import { storage } from "../storage";
import { aiProvider } from "./ai-factory";
import { buildAgentSummaryPrompt } from "./ai-provider";
import { logger } from "./logger";
import type { CallSummary, CoachingSession } from "@shared/schema";

// Thresholds for auto-recommendations
const THRESHOLDS = {
  lowScore: 5,            // Performance score below this triggers recommendation
  lowSubScore: 5,         // Sub-score below this triggers category-specific recommendation
  minCallsForTrend: 3,    // Minimum calls to detect a trend
  sentimentDecline: -0.3, // Sentiment score decline to flag
};

export interface CoachingRecommendation {
  employeeId: string;
  trigger: string;
  category: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  callIds: string[];
  metrics: Record<string, unknown>;
}

/**
 * Analyze an employee's recent calls and generate coaching recommendations.
 * Called after call analysis completes or on demand.
 */
export async function generateRecommendations(
  orgId: string,
  employeeId: string,
): Promise<CoachingRecommendation[]> {
  const recommendations: CoachingRecommendation[] = [];

  try {
    const allCalls = await storage.getCallSummaries(orgId, { employee: employeeId, status: "completed" });
    if (allCalls.length < THRESHOLDS.minCallsForTrend) return [];

    // Sort by date descending — most recent first
    const calls = allCalls
      .filter(c => c.analysis?.performanceScore != null)
      .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime());

    if (calls.length < THRESHOLDS.minCallsForTrend) return [];

    const recentCalls = calls.slice(0, 10);
    const employee = await storage.getEmployee(orgId, employeeId);
    const employeeName = employee?.name || "Agent";

    // 1. Check overall performance score
    const avgScore = average(recentCalls.map(c => Number(c.analysis?.performanceScore) || 0));
    if (avgScore < THRESHOLDS.lowScore) {
      recommendations.push({
        employeeId,
        trigger: "low_performance",
        category: "general",
        title: `${employeeName}: Low overall performance (avg ${avgScore.toFixed(1)}/10)`,
        description: `${employeeName}'s average performance score over the last ${recentCalls.length} calls is ${avgScore.toFixed(1)}/10, below the ${THRESHOLDS.lowScore}/10 threshold.`,
        severity: avgScore < 3 ? "high" : "medium",
        callIds: recentCalls.slice(0, 5).map(c => c.id),
        metrics: { avgScore, callCount: recentCalls.length },
      });
    }

    // 2. Check sub-scores
    const subScoreChecks = [
      { key: "compliance", label: "Compliance" },
      { key: "customerExperience", label: "Customer Experience" },
      { key: "communication", label: "Communication" },
      { key: "resolution", label: "Resolution" },
    ] as const;

    for (const { key, label } of subScoreChecks) {
      const scores = recentCalls
        .map(c => {
          const val = (c.analysis?.subScores as Record<string, unknown> | undefined)?.[key];
          return val != null ? Number(val) : undefined;
        })
        .filter((s): s is number => s != null && !isNaN(s));

      if (scores.length >= THRESHOLDS.minCallsForTrend) {
        const avg = average(scores);
        if (avg < THRESHOLDS.lowSubScore) {
          recommendations.push({
            employeeId,
            trigger: `low_${key}`,
            category: key,
            title: `${employeeName}: Low ${label.toLowerCase()} (avg ${avg.toFixed(1)}/10)`,
            description: `${employeeName}'s ${label.toLowerCase()} sub-score averages ${avg.toFixed(1)}/10 over ${scores.length} recent calls.`,
            severity: avg < 3 ? "high" : "medium",
            callIds: recentCalls.slice(0, 3).map(c => c.id),
            metrics: { [`avg_${key}`]: avg, callCount: scores.length },
          });
        }
      }
    }

    // 3. Check sentiment trend
    const sentimentScores = recentCalls
      .map(c => c.sentiment?.overallScore != null ? Number(c.sentiment.overallScore) : undefined)
      .filter((s): s is number => s != null && !isNaN(s));

    if (sentimentScores.length >= THRESHOLDS.minCallsForTrend) {
      const avgSentiment = average(sentimentScores);
      if (avgSentiment < THRESHOLDS.sentimentDecline) {
        recommendations.push({
          employeeId,
          trigger: "negative_sentiment_trend",
          category: "communication",
          title: `${employeeName}: Negative sentiment trend (avg ${avgSentiment.toFixed(2)})`,
          description: `${employeeName}'s calls show a negative sentiment trend. Consider de-escalation training.`,
          severity: avgSentiment < -0.5 ? "high" : "medium",
          callIds: recentCalls.slice(0, 3).map(c => c.id),
          metrics: { avgSentiment, callCount: sentimentScores.length },
        });
      }
    }

    // 4. Check for recurring flags
    const flagCounts: Record<string, number> = {};
    for (const call of recentCalls) {
      const flags = call.analysis?.flags;
      if (Array.isArray(flags)) {
        for (const flag of flags) {
          const f = typeof flag === "string" ? flag : "";
          if (f) flagCounts[f] = (flagCounts[f] || 0) + 1;
        }
      }
    }

    for (const [flag, count] of Object.entries(flagCounts)) {
      if (count >= 2) {
        recommendations.push({
          employeeId,
          trigger: `recurring_flag_${flag}`,
          category: "compliance",
          title: `${employeeName}: Recurring "${flag.replace(/_/g, " ")}" flag (${count}x)`,
          description: `The "${flag.replace(/_/g, " ")}" flag has been triggered ${count} times in the last ${recentCalls.length} calls.`,
          severity: count >= 3 ? "high" : "medium",
          callIds: recentCalls.filter(c => {
            const flags = c.analysis?.flags;
            return Array.isArray(flags) && flags.includes(flag);
          }).map(c => c.id),
          metrics: { flag, count, totalCalls: recentCalls.length },
        });
      }
    }
  } catch (error) {
    logger.error({ err: error, orgId, employeeId }, "Failed to generate coaching recommendations");
  }

  return recommendations;
}

/**
 * Persist recommendations to the database, deduplicating against existing pending ones.
 */
export async function saveRecommendations(
  orgId: string,
  recommendations: CoachingRecommendation[],
): Promise<number> {
  let saved = 0;
  try {
    const { getDatabase } = await import("../db/index");
    const db = getDatabase();
    if (!db) return 0;

    const { coachingRecommendations } = await import("../db/schema");
    const { eq, and } = await import("drizzle-orm");

    for (const rec of recommendations) {
      // Check for existing pending recommendation with same trigger + employee
      const existing = await db.select().from(coachingRecommendations)
        .where(and(
          eq(coachingRecommendations.orgId, orgId),
          eq(coachingRecommendations.employeeId, rec.employeeId),
          eq(coachingRecommendations.trigger, rec.trigger),
          eq(coachingRecommendations.status, "pending"),
        ))
        .limit(1);

      if (existing.length > 0) continue; // Already exists

      await db.insert(coachingRecommendations).values({
        id: randomUUID(),
        orgId,
        employeeId: rec.employeeId,
        trigger: rec.trigger,
        category: rec.category,
        title: rec.title,
        description: rec.description,
        severity: rec.severity,
        callIds: rec.callIds,
        metrics: rec.metrics,
        status: "pending",
      });
      saved++;
    }
  } catch (error) {
    logger.error({ err: error, orgId }, "Failed to save coaching recommendations");
  }
  return saved;
}

/**
 * Generate an AI coaching plan for a coaching session.
 * Uses the employee's recent call analyses to produce actionable coaching content.
 */
export async function generateCoachingPlan(
  orgId: string,
  sessionId: string,
): Promise<{ plan: string } | null> {
  if (!aiProvider.isAvailable || !aiProvider.generateText) {
    return null;
  }

  const session = await getCoachingSession(orgId, sessionId);
  if (!session) return null;

  const employee = await storage.getEmployee(orgId, session.employeeId);
  if (!employee) return null;

  const calls = await storage.getCallSummaries(orgId, { employee: session.employeeId, status: "completed" });
  const recentCalls = calls
    .filter(c => c.analysis?.performanceScore != null)
    .sort((a, b) => new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime())
    .slice(0, 10);

  if (recentCalls.length === 0) return null;

  const avgScore = average(recentCalls.map(c => Number(c.analysis?.performanceScore) || 0));
  const callSummaries = recentCalls.slice(0, 5).map(c => ({
    score: c.analysis?.performanceScore,
    subScores: c.analysis?.subScores,
    summary: c.analysis?.summary,
    feedback: c.analysis?.feedback,
    flags: c.analysis?.flags,
    sentiment: c.sentiment?.overallSentiment,
  }));

  const prompt = `You are a call center coaching expert. Generate a structured coaching action plan for the following agent.

Agent: ${employee.name}
Role: ${employee.role || "Agent"}
Coaching Category: ${session.category}
Session Title: ${session.title}
${session.notes ? `Manager Notes: ${session.notes}` : ""}

Performance Summary (last ${recentCalls.length} calls):
- Average Score: ${avgScore.toFixed(1)}/10
- Recent Call Details:
${JSON.stringify(callSummaries, null, 2)}

Generate a coaching plan in the following JSON format:
{
  "summary": "Brief assessment of current performance",
  "strengths": ["strength 1", "strength 2"],
  "areasForImprovement": ["area 1", "area 2"],
  "actionItems": [
    { "task": "Specific action item", "priority": "high|medium|low", "timeline": "e.g. 1 week" }
  ],
  "trainingRecommendations": ["recommendation 1"],
  "targetMetrics": {
    "targetScore": 7.5,
    "focusAreas": ["compliance", "communication"]
  }
}

Return ONLY valid JSON, no markdown or extra text.`;

  try {
    const response = await aiProvider.generateText(prompt);
    return { plan: response };
  } catch (error) {
    logger.error({ err: error, orgId, sessionId }, "Failed to generate coaching plan");
    return null;
  }
}

/**
 * Calculate coaching effectiveness: compare pre/post coaching metrics.
 */
export async function calculateEffectiveness(
  orgId: string,
  sessionId: string,
): Promise<{
  preCoaching: { avgScore: number; callCount: number; subScores: Record<string, number> };
  postCoaching: { avgScore: number; callCount: number; subScores: Record<string, number> };
  improvement: { score: number; subScores: Record<string, number> };
} | null> {
  const session = await getCoachingSession(orgId, sessionId);
  if (!session) return null;

  const calls = await storage.getCallSummaries(orgId, { employee: session.employeeId, status: "completed" });
  const scoredCalls = calls
    .filter(c => c.analysis?.performanceScore != null && c.uploadedAt)
    .sort((a, b) => new Date(a.uploadedAt || 0).getTime() - new Date(b.uploadedAt || 0).getTime());

  const sessionDate = new Date(session.createdAt || 0);

  const preCalls = scoredCalls.filter(c => new Date(c.uploadedAt || 0) < sessionDate);
  const postCalls = scoredCalls.filter(c => new Date(c.uploadedAt || 0) >= sessionDate);

  if (preCalls.length === 0 || postCalls.length === 0) return null;

  const preMetrics = computeMetrics(preCalls.slice(-10)); // Last 10 before
  const postMetrics = computeMetrics(postCalls.slice(0, 10)); // First 10 after

  return {
    preCoaching: preMetrics,
    postCoaching: postMetrics,
    improvement: {
      score: postMetrics.avgScore - preMetrics.avgScore,
      subScores: {
        compliance: (postMetrics.subScores.compliance || 0) - (preMetrics.subScores.compliance || 0),
        customerExperience: (postMetrics.subScores.customerExperience || 0) - (preMetrics.subScores.customerExperience || 0),
        communication: (postMetrics.subScores.communication || 0) - (preMetrics.subScores.communication || 0),
        resolution: (postMetrics.subScores.resolution || 0) - (preMetrics.subScores.resolution || 0),
      },
    },
  };
}

// --- Helpers ---

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function computeMetrics(calls: CallSummary[]): { avgScore: number; callCount: number; subScores: Record<string, number> } {
  const scores = calls.map(c => Number(c.analysis?.performanceScore) || 0);
  const subScoreKeys = ["compliance", "customerExperience", "communication", "resolution"];

  const subScores: Record<string, number> = {};
  for (const key of subScoreKeys) {
    const vals = calls
      .map(c => {
        const val = (c.analysis?.subScores as Record<string, unknown> | undefined)?.[key];
        return val != null ? Number(val) : undefined;
      })
      .filter((v): v is number => v != null && !isNaN(v));
    subScores[key] = vals.length > 0 ? average(vals) : 0;
  }

  return {
    avgScore: average(scores),
    callCount: calls.length,
    subScores,
  };
}

async function getCoachingSession(orgId: string, sessionId: string): Promise<CoachingSession | null> {
  try {
    const sessions = await storage.getAllCoachingSessions(orgId);
    return sessions.find(s => s.id === sessionId) || null;
  } catch {
    return null;
  }
}
