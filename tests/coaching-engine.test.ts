/**
 * Tests for coaching engine recommendation logic.
 * Tests threshold checks, severity assignment, and recommendation generation
 * using MemStorage with mock call data.
 *
 * Run with: npx tsx --test tests/coaching-engine.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We test the exported generateRecommendations by setting up MemStorage with test data.
// Since the coaching engine imports `storage` from the storage singleton, we need
// to pre-populate it before calling generateRecommendations.

describe("Coaching Engine", () => {
  // Test the recommendation logic by importing and exercising it with populated storage.
  // Since the module depends on storage singleton, we populate MemStorage.

  let storage: any;
  let generateRecommendations: any;

  beforeEach(async () => {
    // Import storage and populate with test data
    const storageModule = await import("../server/storage/index.js");
    storage = storageModule.storage;

    const engineModule = await import("../server/services/coaching-engine.js");
    generateRecommendations = engineModule.generateRecommendations;
  });

  const ORG_ID = "coaching-test-org";

  async function setupEmployee(name: string): Promise<string> {
    const emp = await storage.createEmployee(ORG_ID, {
      name,
      email: `${name.toLowerCase().replace(/\s/g, "")}@test.com`,
      role: "Agent",
      status: "active",
    });
    return emp.id;
  }

  async function createCallWithAnalysis(
    employeeId: string,
    score: number,
    subScores?: Record<string, number>,
    sentimentScore?: number,
    flags?: string[],
  ) {
    const call = await storage.createCall(ORG_ID, {
      fileName: `test-${Date.now()}-${Math.random()}.mp3`,
      status: "completed",
      employeeId,
      uploadedAt: new Date().toISOString(),
    });

    await storage.createCallAnalysis(ORG_ID, {
      callId: call.id,
      performanceScore: score,
      subScores: subScores || { compliance: score, customerExperience: score, communication: score, resolution: score },
      summary: "Test analysis",
      topics: ["test"],
      feedback: { strengths: [], suggestions: [] },
      flags: flags || [],
    });

    if (sentimentScore !== undefined) {
      await storage.createSentimentAnalysis(ORG_ID, {
        callId: call.id,
        overallSentiment: sentimentScore > 0 ? "positive" : sentimentScore < 0 ? "negative" : "neutral",
        overallScore: sentimentScore,
        segments: [],
      });
    }

    return call.id;
  }

  describe("generateRecommendations", () => {
    it("returns empty when employee has fewer than 3 calls", async () => {
      const empId = await setupEmployee("New Agent");
      await createCallWithAnalysis(empId, 3);
      await createCallWithAnalysis(empId, 3);

      const recs = await generateRecommendations(ORG_ID, empId);
      assert.equal(recs.length, 0);
    });

    it("generates low performance recommendation when avg score < 5", async () => {
      const empId = await setupEmployee("Low Performer");
      for (let i = 0; i < 5; i++) {
        await createCallWithAnalysis(empId, 3);
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const lowPerf = recs.find((r: any) => r.trigger === "low_performance");
      assert.ok(lowPerf, "Should generate low_performance recommendation");
      assert.equal(lowPerf.category, "general");
      assert.ok(lowPerf.severity === "medium" || lowPerf.severity === "high");
    });

    it("assigns high severity when avg score < 3", async () => {
      const empId = await setupEmployee("Very Low Performer");
      for (let i = 0; i < 4; i++) {
        await createCallWithAnalysis(empId, 2);
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const lowPerf = recs.find((r: any) => r.trigger === "low_performance");
      assert.ok(lowPerf);
      assert.equal(lowPerf.severity, "high");
    });

    it("does not generate low performance recommendation when avg >= 5", async () => {
      const empId = await setupEmployee("Good Performer");
      for (let i = 0; i < 5; i++) {
        await createCallWithAnalysis(empId, 7);
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const lowPerf = recs.find((r: any) => r.trigger === "low_performance");
      assert.equal(lowPerf, undefined);
    });

    it("generates sub-score specific recommendations", async () => {
      const empId = await setupEmployee("Low Compliance Agent");
      for (let i = 0; i < 4; i++) {
        await createCallWithAnalysis(empId, 7, {
          compliance: 3,
          customerExperience: 8,
          communication: 8,
          resolution: 8,
        });
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const complianceRec = recs.find((r: any) => r.trigger === "low_compliance");
      assert.ok(complianceRec, "Should flag low compliance sub-score");
      assert.equal(complianceRec.category, "compliance");
    });

    it("generates negative sentiment recommendation", async () => {
      const empId = await setupEmployee("Negative Sentiment Agent");
      for (let i = 0; i < 4; i++) {
        await createCallWithAnalysis(empId, 6, undefined, -0.5);
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const sentRec = recs.find((r: any) => r.trigger === "negative_sentiment_trend");
      assert.ok(sentRec, "Should flag negative sentiment trend");
      assert.equal(sentRec.category, "communication");
    });

    it("generates recurring flag recommendation", async () => {
      const empId = await setupEmployee("Flagged Agent");
      for (let i = 0; i < 4; i++) {
        await createCallWithAnalysis(empId, 6, undefined, undefined, ["agent_misconduct"]);
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const flagRec = recs.find((r: any) => r.trigger.startsWith("recurring_flag_"));
      assert.ok(flagRec, "Should flag recurring flags");
      assert.equal(flagRec.category, "compliance");
    });

    it("includes relevant callIds in recommendations", async () => {
      const empId = await setupEmployee("Tracked Agent");
      const callIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        callIds.push(await createCallWithAnalysis(empId, 2));
      }

      const recs = await generateRecommendations(ORG_ID, empId);
      const lowPerf = recs.find((r: any) => r.trigger === "low_performance");
      assert.ok(lowPerf);
      assert.ok(lowPerf.callIds.length > 0, "Should include call IDs");
    });
  });
});
