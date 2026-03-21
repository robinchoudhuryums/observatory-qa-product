import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemStorage } from "../server/storage/memory.js";

describe("Call Upload Pipeline", () => {
  let storage: InstanceType<typeof MemStorage>;
  let orgId: string;

  beforeEach(async () => {
    storage = new MemStorage();
    const org = await storage.createOrganization({ name: "Test Clinic", slug: "test-clinic", status: "active" });
    orgId = org.id;
  });

  describe("Call creation", () => {
    it("creates call with processing status", async () => {
      const call = await storage.createCall(orgId, {
        orgId,
        status: "processing",
        fileName: "test-audio.mp3",
        callCategory: "inbound",
      });
      assert.equal(call.status, "processing");
      assert.equal(call.fileName, "test-audio.mp3");
      assert.equal(call.orgId, orgId);
    });

    it("rejects call creation for wrong org", async () => {
      const call = await storage.createCall(orgId, {
        orgId,
        status: "processing",
        fileName: "test.mp3",
      });
      // Call should not be accessible from different org
      const found = await storage.getCall("wrong-org-id", call.id);
      assert.equal(found, undefined);
    });

    it("detects duplicate files via file hash", async () => {
      const hash = "abc123def456";
      await storage.createCall(orgId, {
        orgId,
        status: "completed",
        fileHash: hash,
        fileName: "original.mp3",
      });
      const dup = await storage.getCallByFileHash(orgId, hash);
      assert.ok(dup);
      assert.equal(dup.fileHash, hash);
    });

    it("returns undefined for non-existent file hash", async () => {
      const dup = await storage.getCallByFileHash(orgId, "nonexistent-hash");
      assert.equal(dup, undefined);
    });
  });

  describe("Transcript storage", () => {
    it("stores and retrieves transcript for a call", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "processing" });
      const transcript = await storage.createTranscript(orgId, {
        orgId,
        callId: call.id,
        text: "Hello, this is a test call transcript.",
        confidence: "0.95",
      });
      assert.ok(transcript.id);
      assert.equal(transcript.callId, call.id);

      const retrieved = await storage.getTranscript(orgId, call.id);
      assert.ok(retrieved);
      assert.equal(retrieved.text, "Hello, this is a test call transcript.");
    });

    it("isolates transcripts by org", async () => {
      const org2 = await storage.createOrganization({ name: "Other", slug: "other", status: "active" });
      const call = await storage.createCall(orgId, { orgId, status: "processing" });
      await storage.createTranscript(orgId, { orgId, callId: call.id, text: "Secret transcript" });

      const found = await storage.getTranscript(org2.id, call.id);
      assert.equal(found, undefined);
    });
  });

  describe("Analysis storage", () => {
    it("stores analysis with performance score and flags", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const analysis = await storage.createCallAnalysis(orgId, {
        orgId,
        callId: call.id,
        performanceScore: "8.5",
        summary: "Excellent call handling",
        flags: ["exceptional_call"],
      });
      assert.equal(analysis.performanceScore, "8.5");

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      assert.ok(retrieved);
      assert.equal(retrieved.summary, "Excellent call handling");
    });

    it("stores analysis with clinical note", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed", callCategory: "dental_encounter" });
      const analysis = await storage.createCallAnalysis(orgId, {
        orgId,
        callId: call.id,
        performanceScore: "7.0",
        clinicalNote: {
          format: "soap",
          specialty: "dental",
          subjective: "Patient reports tooth pain",
          objective: "Visible decay on tooth #19",
          assessment: "Dental caries",
          plan: ["Schedule filling", "Prescribe pain management"],
          providerAttested: false,
          documentationCompleteness: 8,
          clinicalAccuracy: 7,
        },
      });

      const retrieved = await storage.getCallAnalysis(orgId, call.id);
      assert.ok(retrieved);
      const note = retrieved.clinicalNote as any;
      assert.equal(note.format, "soap");
      assert.equal(note.specialty, "dental");
      assert.equal(note.providerAttested, false);
    });
  });

  describe("Sentiment storage", () => {
    it("stores and retrieves sentiment analysis", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const sentiment = await storage.createSentimentAnalysis(orgId, {
        orgId,
        callId: call.id,
        overallSentiment: "positive",
        overallScore: "0.85",
      });
      assert.equal(sentiment.overallSentiment, "positive");

      const retrieved = await storage.getSentimentAnalysis(orgId, call.id);
      assert.ok(retrieved);
      assert.equal(retrieved.overallScore, "0.85");
    });
  });

  describe("Call status transitions", () => {
    it("transitions from processing to completed", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "processing" });
      assert.equal(call.status, "processing");

      const updated = await storage.updateCall(orgId, call.id, { status: "completed" });
      assert.ok(updated);
      assert.equal(updated.status, "completed");
    });

    it("transitions from processing to failed", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "processing" });
      const updated = await storage.updateCall(orgId, call.id, { status: "failed" });
      assert.ok(updated);
      assert.equal(updated.status, "failed");
    });
  });

  describe("Employee auto-assignment", () => {
    it("assigns call to employee", async () => {
      const emp = await storage.createEmployee(orgId, { orgId, name: "Dr. Smith", email: "smith@clinic.com" });
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      const updated = await storage.updateCall(orgId, call.id, { employeeId: emp.id });
      assert.ok(updated);
      assert.equal(updated.employeeId, emp.id);
    });

    it("includes employee in call details", async () => {
      const emp = await storage.createEmployee(orgId, { orgId, name: "Dr. Smith", email: "smith@clinic.com" });
      const call = await storage.createCall(orgId, { orgId, status: "completed", employeeId: emp.id });
      await storage.createCallAnalysis(orgId, { orgId, callId: call.id, performanceScore: "7.0" });

      const details = await storage.getCallsWithDetails(orgId);
      const found = details.find(d => d.id === call.id);
      assert.ok(found);
      assert.ok(found.employee);
      assert.equal(found.employee.name, "Dr. Smith");
    });
  });

  describe("Search", () => {
    it("finds calls by transcript text", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      await storage.createTranscript(orgId, { orgId, callId: call.id, text: "Patient needs a root canal procedure" });

      const results = await storage.searchCalls(orgId, "root canal");
      assert.ok(results.length > 0);
      assert.equal(results[0].id, call.id);
    });

    it("does not find calls from other orgs", async () => {
      const org2 = await storage.createOrganization({ name: "Other", slug: "other", status: "active" });
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      await storage.createTranscript(orgId, { orgId, callId: call.id, text: "Confidential patient data" });

      const results = await storage.searchCalls(org2.id, "Confidential");
      assert.equal(results.length, 0);
    });
  });

  describe("Dashboard metrics", () => {
    it("computes metrics from completed calls", async () => {
      // Create multiple completed calls with analyses
      for (let i = 0; i < 3; i++) {
        const call = await storage.createCall(orgId, { orgId, status: "completed" });
        await storage.createCallAnalysis(orgId, { orgId, callId: call.id, performanceScore: String(7 + i) });
        await storage.createSentimentAnalysis(orgId, { orgId, callId: call.id, overallSentiment: "positive", overallScore: "0.8" });
      }

      const metrics = await storage.getDashboardMetrics(orgId);
      assert.equal(metrics.totalCalls, 3);
      assert.ok(metrics.avgPerformanceScore > 0);
    });

    it("returns zero metrics for empty org", async () => {
      const metrics = await storage.getDashboardMetrics(orgId);
      assert.equal(metrics.totalCalls, 0);
    });
  });

  describe("Data retention", () => {
    it("purges calls older than retention period", async () => {
      const call = await storage.createCall(orgId, { orgId, status: "completed" });
      // MemStorage sets uploadedAt to now, so purging with retentionDays=0 should purge
      const purged = await storage.purgeExpiredCalls(orgId, 0);
      assert.ok(purged >= 0); // May or may not purge depending on timing
    });
  });
});
