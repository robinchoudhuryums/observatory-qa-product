import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import { BADGE_DEFINITIONS, type BadgeId } from "@shared/schema";

// Points awarded for various activities
const POINT_VALUES = {
  call_processed: 10,
  high_score: 25,       // score >= 9.0
  perfect_score: 50,    // score == 10.0
  self_review: 15,
  coaching_completed: 20,
  streak_day: 5,
} as const;

/**
 * Check and award badges based on employee activity.
 * Called after calls are processed, coaching completed, etc.
 */
export async function checkAndAwardBadges(orgId: string, employeeId: string): Promise<void> {
  try {
    const calls = await storage.getAllCalls(orgId);
    const employeeCalls = calls.filter(c => c.employeeId === employeeId && c.status === "completed");
    const existingBadges = await storage.getEmployeeBadges(orgId, employeeId);
    const hasBadge = (id: string) => existingBadges.some(b => b.badgeId === id);

    const now = new Date().toISOString();

    // Milestone badges
    if (employeeCalls.length >= 1 && !hasBadge("first_call")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "first_call", awardedAt: now });
    }
    if (employeeCalls.length >= 10 && !hasBadge("ten_calls")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "ten_calls", awardedAt: now });
    }
    if (employeeCalls.length >= 100 && !hasBadge("hundred_calls")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "hundred_calls", awardedAt: now });
    }

    // Performance badges — need analysis data
    const analyses = [];
    for (const call of employeeCalls.slice(-20)) { // Check last 20 calls
      const analysis = await storage.getCallAnalysis(orgId, call.id);
      if (analysis) analyses.push({ callId: call.id, score: parseFloat(String(analysis.performanceScore || "0")) });
    }

    const highScoreCalls = analyses.filter(a => a.score >= 9.0);
    if (highScoreCalls.length >= 5 && !hasBadge("high_performer")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "high_performer", awardedAt: now });
    }

    const perfectCall = analyses.find(a => a.score === 10.0);
    if (perfectCall && !hasBadge("perfect_score")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "perfect_score", awardedAt: now, awardedFor: perfectCall.callId });
    }

    // Streak badges
    const profile = await storage.getGamificationProfile(orgId, employeeId);
    if (profile.currentStreak >= 7 && !hasBadge("streak_7")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "streak_7", awardedAt: now });
    }
    if (profile.currentStreak >= 30 && !hasBadge("streak_30")) {
      await storage.awardBadge(orgId, { orgId, employeeId, badgeId: "streak_30", awardedAt: now });
    }
  } catch (error) {
    logger.error({ err: error, orgId, employeeId }, "Failed to check/award badges");
  }
}

/**
 * Update streak and points for an employee.
 * Call this when an employee has a call processed.
 */
export async function recordActivity(orgId: string, employeeId: string, pointType: keyof typeof POINT_VALUES): Promise<void> {
  try {
    const profile = await storage.getGamificationProfile(orgId, employeeId);
    const today = new Date().toISOString().slice(0, 10);

    // Update streak
    let newStreak = profile.currentStreak;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // We track last activity date to determine streak continuity
    // This is a simplified approach — in production you'd use a more robust date comparison
    const lastActivity = (profile as { lastActivityDate?: string }).lastActivityDate;
    if (lastActivity === today) {
      // Already active today, no streak change
    } else if (lastActivity === yesterday) {
      newStreak = profile.currentStreak + 1;
    } else {
      newStreak = 1; // streak broken
    }

    const newPoints = profile.totalPoints + POINT_VALUES[pointType];
    const newLongest = Math.max(profile.longestStreak, newStreak);

    await storage.updateGamificationProfile(orgId, employeeId, {
      totalPoints: newPoints,
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastActivityDate: today,
    });

    // Check for new badges
    await checkAndAwardBadges(orgId, employeeId);
  } catch (error) {
    logger.error({ err: error, orgId, employeeId, pointType }, "Failed to record gamification activity");
  }
}

export function registerGamificationRoutes(app: Express) {
  // Get leaderboard for the org
  app.get("/api/gamification/leaderboard", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const limit = parseInt(req.query.limit as string) || 20;
      const leaderboardData = await storage.getLeaderboard(orgId, limit);

      // Enrich with employee names and avg performance scores
      const employees = await storage.getAllEmployees(orgId);
      const employeeMap = new Map(employees.map(e => [e.id, e]));

      const leaderboard = leaderboardData.map((entry, idx) => {
        const employee = employeeMap.get(entry.employeeId);
        return {
          ...entry,
          employeeName: employee?.name || "Unknown",
          rank: idx + 1,
          level: Math.floor(entry.totalPoints / 100),
        };
      });

      res.json(leaderboard);
    } catch (error) {
      logger.error({ err: error }, "Failed to get leaderboard");
      res.status(500).json({ message: "Failed to get leaderboard" });
    }
  });

  // Get gamification profile for an employee
  app.get("/api/gamification/profile/:employeeId", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const orgId = req.orgId;
      if (!orgId) return res.status(403).json({ message: "Organization context required" });

      const { employeeId } = req.params;
      const [profile, badges, employee] = await Promise.all([
        storage.getGamificationProfile(orgId, employeeId),
        storage.getEmployeeBadges(orgId, employeeId),
        storage.getEmployee(orgId, employeeId),
      ]);

      if (!employee) return res.status(404).json({ message: "Employee not found" });

      // Enrich badges with definitions
      const enrichedBadges = badges.map(b => {
        const def = BADGE_DEFINITIONS.find(d => d.id === b.badgeId);
        return { ...b, name: def?.name, description: def?.description, icon: def?.icon, category: def?.category };
      });

      res.json({
        employeeId,
        employeeName: employee.name,
        totalPoints: profile.totalPoints,
        currentStreak: profile.currentStreak,
        longestStreak: profile.longestStreak,
        level: Math.floor(profile.totalPoints / 100),
        badges: enrichedBadges,
        availableBadges: BADGE_DEFINITIONS.filter(d => !badges.some(b => b.badgeId === d.id)),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to get gamification profile");
      res.status(500).json({ message: "Failed to get gamification profile" });
    }
  });

  // Get all badge definitions
  app.get("/api/gamification/badges", requireAuth, async (_req, res) => {
    res.json(BADGE_DEFINITIONS);
  });
}
