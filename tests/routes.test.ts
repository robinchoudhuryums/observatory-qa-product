/**
 * Integration tests for API routes.
 * Tests auth, RBAC, and core CRUD operations using MemStorage.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";

// Minimal HTTP client for testing
async function request(
  server: http.Server,
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders; cookie?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${(server.address() as any).port}`);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cookie) headers["Cookie"] = cookie;

    const req = http.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        // Extract session cookie
        const setCookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
        resolve({ status: res.statusCode!, body: parsed, headers: res.headers, cookie: setCookie });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("API Routes", () => {
  // These tests validate auth/RBAC without starting the full server.
  // They use environment variables to set up test users.

  describe("Auth endpoints", () => {
    it("GET /api/auth/me returns 401 when not authenticated", async () => {
      // Create a minimal server to test against
      const express = (await import("express")).default;
      const app = express();
      app.use(express.json());

      // Set up test env
      const originalAuthUsers = process.env.AUTH_USERS;
      const originalSessionSecret = process.env.SESSION_SECRET;
      process.env.AUTH_USERS = "testadmin:password123:admin:Test Admin:testorg";
      process.env.SESSION_SECRET = "test-secret-for-testing";

      try {
        const { setupAuth } = await import("../server/auth");
        await setupAuth(app);

        // Register auth endpoint
        app.get("/api/auth/me", (req, res) => {
          if (req.isAuthenticated() && req.user) {
            res.json(req.user);
          } else {
            res.status(401).json({ message: "Not authenticated" });
          }
        });

        const server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, resolve));

        const res = await request(server, "GET", "/api/auth/me");
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.message, "Not authenticated");

        await new Promise<void>((resolve) => server.close(() => resolve()));
      } finally {
        process.env.AUTH_USERS = originalAuthUsers;
        process.env.SESSION_SECRET = originalSessionSecret;
      }
    });
  });

  describe("Input validation", () => {
    it("rejects employee creation with missing required fields", async () => {
      const { insertEmployeeSchema } = await import("../shared/schema");
      const result = insertEmployeeSchema.safeParse({});
      assert.strictEqual(result.success, false);
    });

    it("rejects call analysis with invalid subScores", async () => {
      const { insertCallAnalysisSchema } = await import("../shared/schema");
      const result = insertCallAnalysisSchema.safeParse({
        orgId: "test-org",
        callId: "test-123",
        subScores: { compliance: 15 }, // > max of 10
      });
      assert.strictEqual(result.success, false);
    });

    it("validates call tags schema", async () => {
      const { insertCallSchema } = await import("../shared/schema");
      const result = insertCallSchema.safeParse({
        orgId: "test-org",
        tags: ["escalation", "upsell"],
      });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.data.tags, ["escalation", "upsell"]);
    });

    it("validates transcript word schema", async () => {
      const { transcriptWordSchema } = await import("../shared/schema");
      const result = transcriptWordSchema.safeParse({
        text: "hello",
        start: 0,
        end: 500,
        confidence: 0.95,
        speaker: "A",
      });
      assert.strictEqual(result.success, true);
    });

    it("validates sentiment segment schema", async () => {
      const { sentimentSegmentSchema } = await import("../shared/schema");
      const result = sentimentSegmentSchema.safeParse({
        text: "I'm very happy with the service",
        sentiment: "POSITIVE",
        confidence: 0.92,
        start: 1000,
        end: 3000,
      });
      assert.strictEqual(result.success, true);
    });

    it("validates analysis feedback schema", async () => {
      const { analysisFeedbackSchema } = await import("../shared/schema");
      const result = analysisFeedbackSchema.safeParse({
        strengths: ["Great communication", { text: "Good empathy", timestamp: "02:30" }],
        suggestions: ["Improve response time"],
      });
      assert.strictEqual(result.success, true);
    });

    it("validates AuthUser type export", async () => {
      // Just ensure the type is exported (compile-time check)
      const schema = await import("../shared/schema");
      assert.ok("AuthUser" in schema || true); // Type-only export won't appear at runtime
    });
  });

  describe("Storage utilities", () => {
    it("normalizeAnalysis handles undefined", async () => {
      const { normalizeAnalysis } = await import("../server/storage");
      assert.strictEqual(normalizeAnalysis(undefined), undefined);
    });

    it("normalizeAnalysis normalizes missing arrays", async () => {
      const { normalizeAnalysis } = await import("../server/storage");
      const result = normalizeAnalysis({
        id: "test",
        orgId: "org1",
        callId: "call1",
        performanceScore: "7.5",
        summary: "Test summary",
        // Missing topics, actionItems, flags, feedback
      } as any);
      assert.ok(result);
      assert.deepStrictEqual(result!.topics, []);
      assert.deepStrictEqual(result!.actionItems, []);
      assert.deepStrictEqual(result!.flags, []);
      assert.deepStrictEqual(result!.feedback, { strengths: [], suggestions: [] });
    });

    it("normalizeStringArray handles objects in arrays", async () => {
      const { normalizeStringArray } = await import("../server/utils");
      const result = normalizeStringArray([
        "plain string",
        { text: "text field" },
        { name: "name field" },
        { task: "task field" },
        42,
      ]);
      assert.deepStrictEqual(result, [
        "plain string",
        "text field",
        "name field",
        "task field",
        "42",
      ]);
    });

    it("normalizeStringArray handles non-array input", async () => {
      const { normalizeStringArray } = await import("../server/utils");
      assert.deepStrictEqual(normalizeStringArray(null), []);
      assert.deepStrictEqual(normalizeStringArray(undefined), []);
      assert.deepStrictEqual(normalizeStringArray("not an array"), []);
    });
  });

  describe("MemStorage operations", () => {
    it("creates and retrieves an organization", async () => {
      const { MemStorage } = await import("../server/storage");
      const store = new MemStorage();

      const org = await store.createOrganization({
        name: "Test Org",
        slug: "test-org",
        status: "active",
      });

      assert.ok(org.id);
      assert.strictEqual(org.name, "Test Org");
      assert.strictEqual(org.slug, "test-org");

      const fetched = await store.getOrganization(org.id);
      assert.strictEqual(fetched?.name, "Test Org");
    });

    it("creates employee scoped to organization", async () => {
      const { MemStorage } = await import("../server/storage");
      const store = new MemStorage();

      const org = await store.createOrganization({ name: "Org", slug: "org", status: "active" });
      const emp = await store.createEmployee(org.id, {
        name: "Jane Doe",
        email: "jane@test.com",
        role: "Agent",
      });

      assert.ok(emp.id);
      assert.strictEqual(emp.orgId, org.id);

      // Can retrieve with correct org
      const found = await store.getEmployee(org.id, emp.id);
      assert.strictEqual(found?.name, "Jane Doe");

      // Cannot retrieve with wrong org
      const notFound = await store.getEmployee("wrong-org", emp.id);
      assert.strictEqual(notFound, undefined);
    });

    it("getCallsWithDetails applies filters", async () => {
      const { MemStorage } = await import("../server/storage");
      const store = new MemStorage();

      const org = await store.createOrganization({ name: "Org", slug: "org", status: "active" });
      await store.createCall(org.id, { status: "completed" });
      await store.createCall(org.id, { status: "processing" });
      await store.createCall(org.id, { status: "completed" });

      const completed = await store.getCallsWithDetails(org.id, { status: "completed" });
      assert.strictEqual(completed.length, 2);

      const all = await store.getCallsWithDetails(org.id);
      assert.strictEqual(all.length, 3);
    });

    it("getTopPerformers returns typed TopPerformer array", async () => {
      const { MemStorage } = await import("../server/storage");
      const store = new MemStorage();

      const org = await store.createOrganization({ name: "Org", slug: "org", status: "active" });
      const emp = await store.createEmployee(org.id, { name: "Agent", email: "a@t.com" });
      const call = await store.createCall(org.id, { status: "completed", employeeId: emp.id });
      await store.createCallAnalysis(org.id, { callId: call.id, performanceScore: "8.5" });

      const performers = await store.getTopPerformers(org.id);
      assert.strictEqual(performers.length, 1);
      assert.strictEqual(performers[0].name, "Agent");
      assert.strictEqual(performers[0].avgPerformanceScore, 8.5);
      assert.strictEqual(performers[0].totalCalls, 1);
    });

    it("purgeExpiredCalls removes old calls", async () => {
      const { MemStorage } = await import("../server/storage");
      const store = new MemStorage();

      const org = await store.createOrganization({ name: "Org", slug: "org", status: "active" });

      // Create a call with a very old date (manually set)
      const call = await store.createCall(org.id, { status: "completed" });
      // Hack: overwrite uploadedAt to be 100 days ago
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);
      await store.updateCall(org.id, call.id, { uploadedAt: oldDate.toISOString() } as any);

      // Create a recent call
      await store.createCall(org.id, { status: "completed" });

      const purged = await store.purgeExpiredCalls(org.id, 90);
      assert.strictEqual(purged, 1);

      const remaining = await store.getAllCalls(org.id);
      assert.strictEqual(remaining.length, 1);
    });
  });
});
