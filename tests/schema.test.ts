/**
 * Tests for Zod schema validation — ensures data integrity at system boundaries.
 * Run with: npx tsx --test tests/schema.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  insertCallAnalysisSchema,
  insertCoachingSessionSchema,
  insertAccessRequestSchema,
  insertUserSchema,
  insertEmployeeSchema,
  insertOrganizationSchema,
  organizationSchema,
  orgSettingsSchema,
  insertCallSchema,
  insertTranscriptSchema,
  insertSentimentAnalysisSchema,
  insertPromptTemplateSchema,
} from "../shared/schema.js";

describe("insertCallAnalysisSchema", () => {
  it("accepts valid complete analysis", () => {
    const result = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      callId: "call-123",
      performanceScore: "7.5",
      summary: "Good call",
      topics: ["billing", "shipping"],
      actionItems: ["Follow up"],
      feedback: { strengths: ["Empathy"], suggestions: ["Faster"] },
      flags: ["exceptional_call"],
      subScores: { compliance: 8, customerExperience: 7, communication: 9, resolution: 7 },
      detectedAgentName: "Sarah",
      confidenceScore: "0.85",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("accepts minimal analysis (only callId required)", () => {
    const result = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      callId: "call-456",
    });
    assert.ok(result.success);
  });

  it("rejects missing callId", () => {
    const result = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      performanceScore: "5.0",
    });
    assert.ok(!result.success);
  });

  it("validates sub-score ranges", () => {
    const valid = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      callId: "call-789",
      subScores: { compliance: 10, customerExperience: 0, communication: 5.5, resolution: 10 },
    });
    assert.ok(valid.success);

    const invalid = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      callId: "call-789",
      subScores: { compliance: 11 }, // > 10
    });
    assert.ok(!invalid.success);

    const invalidNeg = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      callId: "call-789",
      subScores: { compliance: -1 }, // < 0
    });
    assert.ok(!invalidNeg.success);
  });

  it("allows undefined for all optional fields on old data", () => {
    const result = insertCallAnalysisSchema.safeParse({
      orgId: "test-org",
      callId: "old-call",
      performanceScore: "6.0",
      summary: "An older call",
      // No subScores, no confidenceScore, no detectedAgentName
    });
    assert.ok(result.success);
    assert.equal(result.data.subScores, undefined);
    assert.equal(result.data.confidenceScore, undefined);
    assert.equal(result.data.detectedAgentName, undefined);
  });
});

describe("insertCoachingSessionSchema", () => {
  it("accepts valid coaching session", () => {
    const result = insertCoachingSessionSchema.safeParse({
      orgId: "test-org",
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Improve greeting compliance",
      category: "compliance",
      notes: "Review HIPAA greeting requirements",
      actionPlan: [
        { task: "Listen to 3 example calls", completed: false },
        { task: "Practice with team lead", completed: false },
      ],
      dueDate: "2026-04-01",
    });
    assert.ok(result.success);
  });

  it("defaults status to pending", () => {
    const result = insertCoachingSessionSchema.safeParse({
      orgId: "test-org",
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "General coaching",
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "pending");
  });

  it("defaults category to general", () => {
    const result = insertCoachingSessionSchema.safeParse({
      orgId: "test-org",
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "General coaching",
    });
    assert.ok(result.success);
    assert.equal(result.data.category, "general");
  });

  it("validates status enum", () => {
    const result = insertCoachingSessionSchema.safeParse({
      orgId: "test-org",
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Test",
      status: "invalid_status",
    });
    assert.ok(!result.success);
  });
});

describe("insertAccessRequestSchema", () => {
  it("accepts valid request", () => {
    const result = insertAccessRequestSchema.safeParse({
      orgId: "test-org",
      name: "John Doe",
      email: "john@example.com",
      reason: "Need access to review calls",
      requestedRole: "viewer",
    });
    assert.ok(result.success);
  });

  it("rejects invalid email", () => {
    const result = insertAccessRequestSchema.safeParse({
      orgId: "test-org",
      name: "John",
      email: "not-an-email",
    });
    assert.ok(!result.success);
  });

  it("rejects empty name", () => {
    const result = insertAccessRequestSchema.safeParse({
      orgId: "test-org",
      name: "",
      email: "john@example.com",
    });
    assert.ok(!result.success);
  });
});

describe("insertUserSchema", () => {
  it("accepts valid user", () => {
    const result = insertUserSchema.safeParse({
      orgId: "org-1",
      username: "admin",
      passwordHash: "hashed_password_here",
      name: "Admin User",
      role: "admin",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("defaults role to viewer", () => {
    const result = insertUserSchema.safeParse({
      orgId: "org-1",
      username: "viewer1",
      passwordHash: "hashed_password_here",
      name: "View Only",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
    assert.equal(result.data.role, "viewer");
  });

  it("requires orgId", () => {
    const result = insertUserSchema.safeParse({
      username: "user1",
      passwordHash: "hashed_password_here",
      name: "No Org",
    });
    assert.ok(!result.success, "Should reject user without orgId");
  });
});

describe("insertEmployeeSchema", () => {
  it("accepts valid employee", () => {
    const result = insertEmployeeSchema.safeParse({
      orgId: "test-org",
      name: "Jane Smith",
      email: "jane@company.com",
      role: "Senior Agent",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("accepts employee without status (optional field)", () => {
    const result = insertEmployeeSchema.safeParse({
      orgId: "test-org",
      name: "New Employee",
      email: "new@company.com",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
    // status is optional — may be undefined when not provided
  });

  it("accepts explicit status value", () => {
    const result = insertEmployeeSchema.safeParse({
      orgId: "test-org",
      name: "Inactive Employee",
      email: "inactive@company.com",
      status: "Inactive",
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "Inactive");
  });

  it("accepts optional orgId", () => {
    const result = insertEmployeeSchema.safeParse({
      name: "Jane Smith",
      email: "jane@acme.com",
      orgId: "org-123",
    });
    assert.ok(result.success);
    assert.equal(result.data.orgId, "org-123");
  });

  it("rejects without orgId (now required)", () => {
    const result = insertEmployeeSchema.safeParse({
      name: "Jane Smith",
      email: "jane@acme.com",
    });
    assert.ok(!result.success, "Should reject employee without orgId");
  });
});

// --- ORGANIZATION SCHEMA TESTS ---
describe("insertOrganizationSchema", () => {
  it("accepts valid organization with all settings", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Acme Medical Supplies",
      slug: "acme-medical",
      settings: {
        emailDomain: "acme.com",
        departments: ["Sales", "Support", "Billing"],
        subTeams: { "Support": ["Tier 1", "Tier 2", "Escalations"] },
        callCategories: ["inbound", "outbound"],
        callPartyTypes: ["customer", "vendor"],
        retentionDays: 180,
        branding: { appName: "AcmeQA", logoUrl: "https://acme.com/logo.png" },
        bedrockModel: "us.anthropic.claude-sonnet-4-6",
      },
      status: "active",
    });
    assert.ok(result.success, `Parse failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("accepts minimal organization (name + slug only)", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Test Org",
      slug: "test-org",
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "active"); // default
  });

  it("rejects empty name", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "",
      slug: "test",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid slug (uppercase)", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Test",
      slug: "TestOrg",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid slug (spaces)", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Test",
      slug: "test org",
    });
    assert.ok(!result.success);
  });

  it("accepts slug with hyphens and numbers", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Test Org 2",
      slug: "test-org-2",
    });
    assert.ok(result.success);
  });

  it("validates status enum", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Test",
      slug: "test",
      status: "invalid",
    });
    assert.ok(!result.success);
  });

  it("accepts trial status", () => {
    const result = insertOrganizationSchema.safeParse({
      name: "Trial Org",
      slug: "trial-org",
      status: "trial",
    });
    assert.ok(result.success);
    assert.equal(result.data.status, "trial");
  });
});

describe("organizationSchema (full entity)", () => {
  it("requires id on full entity", () => {
    const result = organizationSchema.safeParse({
      name: "Test",
      slug: "test",
    });
    assert.ok(!result.success); // missing id
  });

  it("accepts full entity with id", () => {
    const result = organizationSchema.safeParse({
      id: "org-abc",
      name: "Test Org",
      slug: "test-org",
      createdAt: "2026-01-01T00:00:00Z",
    });
    assert.ok(result.success);
  });
});

describe("orgSettingsSchema", () => {
  it("defaults retentionDays to 90", () => {
    const result = orgSettingsSchema.safeParse({});
    assert.ok(result.success);
    assert.equal(result.data.retentionDays, 90);
  });

  it("accepts bedrockModel override", () => {
    const valid = orgSettingsSchema.safeParse({ bedrockModel: "us.anthropic.claude-haiku-4-5-20251001" });
    assert.ok(valid.success);
    assert.equal(valid.data.bedrockModel, "us.anthropic.claude-haiku-4-5-20251001");
  });

  it("accepts branding with default appName", () => {
    const result = orgSettingsSchema.safeParse({
      branding: {},
    });
    assert.ok(result.success);
    assert.equal(result.data.branding?.appName, "Observatory");
  });
});

// --- orgId FIELD TESTS (cross-schema) ---
describe("orgId field across insert schemas", () => {
  it("insertCallSchema accepts orgId", () => {
    const result = insertCallSchema.safeParse({
      orgId: "org-1",
      status: "pending",
    });
    assert.ok(result.success);
    assert.equal(result.data.orgId, "org-1");
  });

  it("insertCallAnalysisSchema accepts orgId", () => {
    const result = insertCallAnalysisSchema.safeParse({
      orgId: "org-1",
      callId: "call-1",
    });
    assert.ok(result.success);
    assert.equal(result.data.orgId, "org-1");
  });

  it("insertTranscriptSchema accepts orgId", () => {
    const result = insertTranscriptSchema.safeParse({
      orgId: "org-1",
      callId: "call-1",
    });
    assert.ok(result.success);
  });

  it("insertSentimentAnalysisSchema accepts orgId", () => {
    const result = insertSentimentAnalysisSchema.safeParse({
      orgId: "org-1",
      callId: "call-1",
    });
    assert.ok(result.success);
  });

  it("insertCoachingSessionSchema accepts orgId", () => {
    const result = insertCoachingSessionSchema.safeParse({
      orgId: "org-1",
      employeeId: "emp-1",
      assignedBy: "mgr-1",
      title: "Test",
    });
    assert.ok(result.success);
  });

  it("insertAccessRequestSchema accepts orgId", () => {
    const result = insertAccessRequestSchema.safeParse({
      orgId: "org-1",
      name: "John",
      email: "john@example.com",
    });
    assert.ok(result.success);
  });

  it("insertPromptTemplateSchema accepts orgId", () => {
    const result = insertPromptTemplateSchema.safeParse({
      orgId: "org-1",
      callCategory: "inbound",
      name: "Default Inbound",
      evaluationCriteria: "Check greeting and compliance",
    });
    assert.ok(result.success);
  });

  it("insertUserSchema accepts orgId", () => {
    const result = insertUserSchema.safeParse({
      orgId: "org-1",
      username: "testuser",
      passwordHash: "hash",
      name: "Test User",
    });
    assert.ok(result.success);
  });

  it("all insert schemas require orgId", () => {
    // Verify all insert schemas require orgId
    const results = [
      insertCallSchema.safeParse({ orgId: "test-org", status: "pending" }),
      insertCallAnalysisSchema.safeParse({ orgId: "test-org", callId: "c1" }),
      insertTranscriptSchema.safeParse({ orgId: "test-org", callId: "c1" }),
      insertSentimentAnalysisSchema.safeParse({ orgId: "test-org", callId: "c1" }),
      insertCoachingSessionSchema.safeParse({ orgId: "test-org", employeeId: "e1", assignedBy: "m1", title: "T" }),
      insertAccessRequestSchema.safeParse({ orgId: "test-org", name: "J", email: "j@x.com" }),
      insertUserSchema.safeParse({ orgId: "org-1", username: "u", passwordHash: "h", name: "N" }),
      insertEmployeeSchema.safeParse({ orgId: "test-org", name: "E", email: "e@x.com" }),
    ];
    results.forEach((r, i) => {
      assert.ok(r.success, `Insert schema ${i} failed with orgId: ${JSON.stringify(r.error?.issues)}`);
    });

    // Verify schemas reject missing orgId
    const withoutOrgId = [
      insertCallSchema.safeParse({ status: "pending" }),
      insertCallAnalysisSchema.safeParse({ callId: "c1" }),
      insertTranscriptSchema.safeParse({ callId: "c1" }),
      insertSentimentAnalysisSchema.safeParse({ callId: "c1" }),
      insertCoachingSessionSchema.safeParse({ employeeId: "e1", assignedBy: "m1", title: "T" }),
      insertAccessRequestSchema.safeParse({ name: "J", email: "j@x.com" }),
      insertEmployeeSchema.safeParse({ name: "E", email: "e@x.com" }),
    ];
    withoutOrgId.forEach((r, i) => {
      assert.ok(!r.success, `Insert schema ${i} should reject missing orgId`);
    });
  });
});
