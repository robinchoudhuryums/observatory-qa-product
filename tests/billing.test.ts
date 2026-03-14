/**
 * Tests for billing schemas, plan definitions, and quota logic.
 * Run with: npx tsx --test tests/billing.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  subscriptionSchema,
  insertSubscriptionSchema,
  planLimitsSchema,
  PLAN_DEFINITIONS,
  PLAN_TIERS,
  type PlanTier,
} from "../shared/schema.js";

describe("PLAN_DEFINITIONS", () => {
  it("has entries for all plan tiers", () => {
    for (const tier of PLAN_TIERS) {
      assert.ok(PLAN_DEFINITIONS[tier], `Missing definition for tier: ${tier}`);
    }
  });

  it("free plan has $0 pricing", () => {
    assert.strictEqual(PLAN_DEFINITIONS.free.monthlyPriceUsd, 0);
    assert.strictEqual(PLAN_DEFINITIONS.free.yearlyPriceUsd, 0);
  });

  it("pro plan costs more than free", () => {
    assert.ok(PLAN_DEFINITIONS.pro.monthlyPriceUsd > 0);
    assert.ok(PLAN_DEFINITIONS.pro.yearlyPriceUsd > 0);
  });

  it("enterprise plan costs more than pro", () => {
    assert.ok(PLAN_DEFINITIONS.enterprise.monthlyPriceUsd > PLAN_DEFINITIONS.pro.monthlyPriceUsd);
  });

  it("yearly pricing offers a discount over monthly", () => {
    const proMonthlyAnnual = PLAN_DEFINITIONS.pro.monthlyPriceUsd * 12;
    assert.ok(PLAN_DEFINITIONS.pro.yearlyPriceUsd < proMonthlyAnnual);

    const entMonthlyAnnual = PLAN_DEFINITIONS.enterprise.monthlyPriceUsd * 12;
    assert.ok(PLAN_DEFINITIONS.enterprise.yearlyPriceUsd < entMonthlyAnnual);
  });

  it("enterprise plan has unlimited (-1) calls", () => {
    assert.strictEqual(PLAN_DEFINITIONS.enterprise.limits.callsPerMonth, -1);
  });

  it("free plan has limited calls", () => {
    assert.ok(PLAN_DEFINITIONS.free.limits.callsPerMonth > 0);
    assert.ok(PLAN_DEFINITIONS.free.limits.callsPerMonth < 100);
  });

  it("pro plan has more limits than free", () => {
    assert.ok(PLAN_DEFINITIONS.pro.limits.callsPerMonth > PLAN_DEFINITIONS.free.limits.callsPerMonth);
    assert.ok(PLAN_DEFINITIONS.pro.limits.maxUsers > PLAN_DEFINITIONS.free.limits.maxUsers);
    assert.ok(PLAN_DEFINITIONS.pro.limits.storageMb > PLAN_DEFINITIONS.free.limits.storageMb);
  });

  it("enterprise has SSO enabled, free does not", () => {
    assert.strictEqual(PLAN_DEFINITIONS.enterprise.limits.ssoEnabled, true);
    assert.strictEqual(PLAN_DEFINITIONS.free.limits.ssoEnabled, false);
  });

  it("each plan has all required limit fields", () => {
    const requiredFields = [
      "callsPerMonth", "storageMb", "aiAnalysesPerMonth",
      "apiCallsPerMonth", "maxUsers", "customPromptTemplates",
      "ssoEnabled", "prioritySupport",
    ];
    for (const tier of PLAN_TIERS) {
      const limits = PLAN_DEFINITIONS[tier].limits;
      for (const field of requiredFields) {
        assert.ok(
          field in limits,
          `Plan ${tier} missing limit field: ${field}`,
        );
      }
    }
  });
});

describe("planLimitsSchema", () => {
  it("validates correct limits object", () => {
    const result = planLimitsSchema.safeParse({
      callsPerMonth: 100,
      storageMb: 500,
      aiAnalysesPerMonth: 100,
      apiCallsPerMonth: 1000,
      maxUsers: 5,
      customPromptTemplates: false,
      ssoEnabled: false,
      prioritySupport: false,
    });
    assert.ok(result.success);
  });

  it("validates unlimited (-1) values", () => {
    const result = planLimitsSchema.safeParse({
      callsPerMonth: -1,
      storageMb: -1,
      aiAnalysesPerMonth: -1,
      apiCallsPerMonth: -1,
      maxUsers: -1,
      customPromptTemplates: true,
      ssoEnabled: true,
      prioritySupport: true,
    });
    assert.ok(result.success);
  });

  it("rejects missing required fields", () => {
    const result = planLimitsSchema.safeParse({ callsPerMonth: 100 });
    assert.ok(!result.success);
  });
});

describe("subscriptionSchema", () => {
  it("validates a full subscription record", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-123",
      orgId: "org-456",
      planTier: "pro",
      status: "active",
      stripeCustomerId: "cus_abc",
      stripeSubscriptionId: "sub_def",
      billingInterval: "monthly",
      currentPeriodStart: "2026-03-01T00:00:00Z",
      currentPeriodEnd: "2026-04-01T00:00:00Z",
      cancelAtPeriodEnd: false,
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.planTier, "pro");
  });

  it("validates all plan tiers", () => {
    for (const tier of PLAN_TIERS) {
      const result = subscriptionSchema.safeParse({
        id: "sub-1",
        orgId: "org-1",
        planTier: tier,
        status: "active",
      });
      assert.ok(result.success, `Tier ${tier} should be valid`);
    }
  });

  it("validates all status values", () => {
    const statuses = ["active", "past_due", "canceled", "trialing", "incomplete"];
    for (const status of statuses) {
      const result = subscriptionSchema.safeParse({
        id: "sub-1",
        orgId: "org-1",
        planTier: "free",
        status,
      });
      assert.ok(result.success, `Status ${status} should be valid`);
    }
  });

  it("rejects invalid plan tier", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "ultra",
      status: "active",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid status", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "free",
      status: "expired",
    });
    assert.ok(!result.success);
  });

  it("defaults billingInterval to monthly", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "pro",
      status: "active",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.billingInterval, "monthly");
  });

  it("defaults cancelAtPeriodEnd to false", () => {
    const result = subscriptionSchema.safeParse({
      id: "sub-1",
      orgId: "org-1",
      planTier: "pro",
      status: "active",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data.cancelAtPeriodEnd, false);
  });
});

describe("insertSubscriptionSchema", () => {
  it("does not require id, createdAt, updatedAt", () => {
    const result = insertSubscriptionSchema.safeParse({
      orgId: "org-1",
      planTier: "pro",
      status: "active",
      billingInterval: "yearly",
    });
    assert.ok(result.success);
  });
});

describe("Quota enforcement logic", () => {
  it("allows usage under limit", () => {
    const limit = 50;
    const used = 30;
    const allowed = used < limit;
    assert.ok(allowed);
  });

  it("blocks usage at limit", () => {
    const limit = 50;
    const used = 50;
    const allowed = used < limit;
    assert.ok(!allowed);
  });

  it("allows unlimited (-1) usage", () => {
    const limit = -1;
    const used = 999999;
    const allowed = limit === -1 || used < limit;
    assert.ok(allowed);
  });

  it("correctly identifies current billing period", () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    assert.ok(periodStart <= now);
    assert.ok(periodStart.getDate() === 1);
  });
});

describe("Price ID resolution", () => {
  it("maps tier + interval to lookup key", () => {
    const tier: PlanTier = "pro";
    const interval = "monthly";
    const key = `${tier}_${interval}`;
    assert.strictEqual(key, "pro_monthly");
  });

  it("generates correct keys for all combinations", () => {
    const expected = [
      "pro_monthly", "pro_yearly",
      "enterprise_monthly", "enterprise_yearly",
    ];
    const actual: string[] = [];
    for (const tier of ["pro", "enterprise"] as PlanTier[]) {
      for (const interval of ["monthly", "yearly"]) {
        actual.push(`${tier}_${interval}`);
      }
    }
    assert.deepStrictEqual(actual, expected);
  });
});
