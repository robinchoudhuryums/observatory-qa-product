/**
 * Multi-tenant isolation tests — verifies that MemStorage properly isolates data by orgId.
 * Run with: npx tsx --test tests/multitenant.test.ts
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We test against MemStorage directly
import { MemStorage } from "../server/storage.js";

let storage: MemStorage;

const ORG_A = "org-alpha";
const ORG_B = "org-beta";

beforeEach(() => {
  storage = new MemStorage();
});

describe("Organization CRUD", () => {
  it("creates and retrieves organization by ID", async () => {
    const org = await storage.createOrganization({ name: "Alpha Inc", slug: "alpha", status: "active" });
    assert.ok(org.id);
    assert.equal(org.name, "Alpha Inc");
    assert.equal(org.slug, "alpha");

    const fetched = await storage.getOrganization(org.id);
    assert.ok(fetched);
    assert.equal(fetched!.name, "Alpha Inc");
  });

  it("retrieves organization by slug", async () => {
    await storage.createOrganization({ name: "Beta Corp", slug: "beta", status: "active" });
    const org = await storage.getOrganizationBySlug("beta");
    assert.ok(org);
    assert.equal(org!.name, "Beta Corp");
  });

  it("returns undefined for non-existent org", async () => {
    const org = await storage.getOrganization("non-existent");
    assert.equal(org, undefined);
  });

  it("lists all organizations", async () => {
    await storage.createOrganization({ name: "Org 1", slug: "org-1", status: "active" });
    await storage.createOrganization({ name: "Org 2", slug: "org-2", status: "trial" });
    const orgs = await storage.listOrganizations();
    assert.equal(orgs.length, 2);
  });

  it("updates organization", async () => {
    const org = await storage.createOrganization({ name: "Old Name", slug: "test", status: "active" });
    const updated = await storage.updateOrganization(org.id, { name: "New Name" });
    assert.ok(updated);
    assert.equal(updated!.name, "New Name");
    assert.equal(updated!.slug, "test"); // slug unchanged
  });
});

describe("Employee isolation", () => {
  it("employees are isolated between orgs", async () => {
    await storage.createEmployee(ORG_A, { name: "Alice", email: "alice@alpha.com" });
    await storage.createEmployee(ORG_B, { name: "Bob", email: "bob@beta.com" });

    const orgAEmployees = await storage.getAllEmployees(ORG_A);
    const orgBEmployees = await storage.getAllEmployees(ORG_B);

    assert.equal(orgAEmployees.length, 1);
    assert.equal(orgAEmployees[0].name, "Alice");
    assert.equal(orgAEmployees[0].orgId, ORG_A);

    assert.equal(orgBEmployees.length, 1);
    assert.equal(orgBEmployees[0].name, "Bob");
    assert.equal(orgBEmployees[0].orgId, ORG_B);
  });

  it("getEmployee only returns from correct org", async () => {
    const emp = await storage.createEmployee(ORG_A, { name: "Alice", email: "alice@a.com" });

    const found = await storage.getEmployee(ORG_A, emp.id);
    assert.ok(found);
    assert.equal(found!.name, "Alice");

    // Should NOT find employee from wrong org
    const notFound = await storage.getEmployee(ORG_B, emp.id);
    assert.equal(notFound, undefined);
  });

  it("getEmployeeByEmail is org-scoped", async () => {
    await storage.createEmployee(ORG_A, { name: "Alice", email: "shared@company.com" });
    await storage.createEmployee(ORG_B, { name: "Bob", email: "shared@company.com" });

    const fromA = await storage.getEmployeeByEmail(ORG_A, "shared@company.com");
    assert.ok(fromA);
    assert.equal(fromA!.name, "Alice");

    const fromB = await storage.getEmployeeByEmail(ORG_B, "shared@company.com");
    assert.ok(fromB);
    assert.equal(fromB!.name, "Bob");
  });
});

describe("Call isolation", () => {
  it("calls are isolated between orgs", async () => {
    await storage.createCall(ORG_A, { status: "pending" });
    await storage.createCall(ORG_A, { status: "completed" });
    await storage.createCall(ORG_B, { status: "pending" });

    const orgACalls = await storage.getCallsWithDetails(ORG_A);
    const orgBCalls = await storage.getCallsWithDetails(ORG_B);

    assert.equal(orgACalls.length, 2);
    assert.equal(orgBCalls.length, 1);
  });

  it("getCall only returns from correct org", async () => {
    const call = await storage.createCall(ORG_A, { status: "pending" });

    const found = await storage.getCall(ORG_A, call.id);
    assert.ok(found);

    const notFound = await storage.getCall(ORG_B, call.id);
    assert.equal(notFound, undefined);
  });
});

describe("Transcript isolation", () => {
  it("transcripts are org-scoped", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.createTranscript(ORG_A, { callId: callA.id, text: "Hello from org A" });

    const found = await storage.getTranscript(ORG_A, callA.id);
    assert.ok(found);
    assert.equal(found!.text, "Hello from org A");

    const notFound = await storage.getTranscript(ORG_B, callA.id);
    assert.equal(notFound, undefined);
  });
});

describe("Analysis isolation", () => {
  it("call analysis is org-scoped", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.createCallAnalysis(ORG_A, { callId: callA.id, performanceScore: "8.5" });

    const found = await storage.getCallAnalysis(ORG_A, callA.id);
    assert.ok(found);
    assert.equal(found!.performanceScore, "8.5");

    const notFound = await storage.getCallAnalysis(ORG_B, callA.id);
    assert.equal(notFound, undefined);
  });
});

describe("Sentiment isolation", () => {
  it("sentiment analysis is org-scoped", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.createSentimentAnalysis(ORG_A, { callId: callA.id, overallSentiment: "positive" });

    const found = await storage.getSentimentAnalysis(ORG_A, callA.id);
    assert.ok(found);
    assert.equal(found!.overallSentiment, "positive");

    const notFound = await storage.getSentimentAnalysis(ORG_B, callA.id);
    assert.equal(notFound, undefined);
  });
});

describe("Dashboard metrics isolation", () => {
  it("metrics are scoped to org", async () => {
    // Create calls in two orgs
    const callA = await storage.createCall(ORG_A, { status: "completed" });
    await storage.createCallAnalysis(ORG_A, { callId: callA.id, performanceScore: "8.0" });
    await storage.createSentimentAnalysis(ORG_A, { callId: callA.id, overallSentiment: "positive", overallScore: "0.8" });

    await storage.createCall(ORG_B, { status: "completed" });

    const metricsA = await storage.getDashboardMetrics(ORG_A);
    const metricsB = await storage.getDashboardMetrics(ORG_B);

    assert.equal(metricsA.totalCalls, 1);
    assert.equal(metricsB.totalCalls, 1);
    // Org A has a performance score, org B should not
    assert.ok(metricsA.avgPerformanceScore > 0);
  });
});

describe("Coaching session isolation", () => {
  it("coaching sessions are org-scoped", async () => {
    const empA = await storage.createEmployee(ORG_A, { name: "Alice", email: "a@a.com" });
    await storage.createCoachingSession(ORG_A, {
      employeeId: empA.id,
      assignedBy: "admin",
      title: "Alpha coaching",
    });

    const empB = await storage.createEmployee(ORG_B, { name: "Bob", email: "b@b.com" });
    await storage.createCoachingSession(ORG_B, {
      employeeId: empB.id,
      assignedBy: "admin",
      title: "Beta coaching",
    });

    const sessionsA = await storage.getAllCoachingSessions(ORG_A);
    const sessionsB = await storage.getAllCoachingSessions(ORG_B);

    assert.equal(sessionsA.length, 1);
    assert.equal(sessionsA[0].title, "Alpha coaching");
    assert.equal(sessionsB.length, 1);
    assert.equal(sessionsB[0].title, "Beta coaching");
  });
});

describe("Access request isolation", () => {
  it("access requests are org-scoped", async () => {
    await storage.createAccessRequest(ORG_A, { name: "Requester A", email: "a@test.com" });
    await storage.createAccessRequest(ORG_B, { name: "Requester B", email: "b@test.com" });

    const reqsA = await storage.getAllAccessRequests(ORG_A);
    const reqsB = await storage.getAllAccessRequests(ORG_B);

    assert.equal(reqsA.length, 1);
    assert.equal(reqsA[0].name, "Requester A");
    assert.equal(reqsB.length, 1);
    assert.equal(reqsB[0].name, "Requester B");
  });
});

describe("Cross-org data leakage prevention", () => {
  it("search is org-scoped", async () => {
    const callA = await storage.createCall(ORG_A, { status: "completed", fileName: "secret-call.mp3" });
    await storage.createTranscript(ORG_A, { callId: callA.id, text: "This is a secret transcript" });
    await storage.createCallAnalysis(ORG_A, { callId: callA.id, summary: "Secret summary" });

    const resultsA = await storage.searchCalls(ORG_A, "secret");
    const resultsB = await storage.searchCalls(ORG_B, "secret");

    assert.ok(resultsA.length > 0, "Org A should find its own data");
    assert.equal(resultsB.length, 0, "Org B should NOT see Org A data");
  });
});
