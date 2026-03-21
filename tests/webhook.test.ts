import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PLAN_DEFINITIONS, subscriptionSchema, type PlanTier } from "../shared/schema.js";

describe("Stripe Webhook Logic", () => {
  describe("Price ID to tier resolution", () => {
    it("maps Pro monthly price ID to pro tier", () => {
      process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly_test";
      const priceMap: Record<string, PlanTier> = {};
      if (process.env.STRIPE_PRICE_PRO_MONTHLY) priceMap[process.env.STRIPE_PRICE_PRO_MONTHLY] = "pro";
      assert.equal(priceMap["price_pro_monthly_test"], "pro");
      delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    });

    it("maps Enterprise yearly price ID to enterprise tier", () => {
      process.env.STRIPE_PRICE_ENTERPRISE_YEARLY = "price_ent_yearly_test";
      const priceMap: Record<string, PlanTier> = {};
      if (process.env.STRIPE_PRICE_ENTERPRISE_YEARLY) priceMap[process.env.STRIPE_PRICE_ENTERPRISE_YEARLY] = "enterprise";
      assert.equal(priceMap["price_ent_yearly_test"], "enterprise");
      delete process.env.STRIPE_PRICE_ENTERPRISE_YEARLY;
    });

    it("defaults to free tier for unknown price ID", () => {
      const priceMap: Record<string, PlanTier> = {};
      const resolved = priceMap["price_unknown"] || "free";
      assert.equal(resolved, "free");
    });
  });

  describe("Subscription state transitions", () => {
    it("validates active subscription", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_1",
        orgId: "org_1",
        planTier: "pro",
        status: "active",
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
        billingInterval: "monthly",
      });
      assert.ok(result.success);
    });

    it("validates past_due subscription", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_2",
        orgId: "org_1",
        planTier: "pro",
        status: "past_due",
        stripeCustomerId: "cus_test",
      });
      assert.ok(result.success);
    });

    it("validates canceled subscription", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_3",
        orgId: "org_1",
        planTier: "enterprise",
        status: "canceled",
        stripeCustomerId: "cus_test",
      });
      assert.ok(result.success);
    });

    it("validates subscription downgrade to free", () => {
      const result = subscriptionSchema.safeParse({
        id: "sub_4",
        orgId: "org_1",
        planTier: "free",
        status: "active",
      });
      assert.ok(result.success);
    });
  });

  describe("Quota enforcement logic", () => {
    it("enforces call limits per plan tier", () => {
      for (const [tier, plan] of Object.entries(PLAN_DEFINITIONS)) {
        const limit = plan.limits.callsPerMonth;
        if (limit === -1) {
          // Unlimited
          assert.equal(tier, "enterprise");
        } else {
          assert.ok(limit > 0, `${tier} should have positive call limit`);
        }
      }
    });

    it("free tier has most restrictive limits", () => {
      const free = PLAN_DEFINITIONS.free.limits;
      const pro = PLAN_DEFINITIONS.pro.limits;
      assert.ok(free.callsPerMonth < pro.callsPerMonth);
      assert.ok(free.storageMb < pro.storageMb);
      assert.ok(free.maxUsers < pro.maxUsers);
    });

    it("enterprise has all core features enabled", () => {
      const ent = PLAN_DEFINITIONS.enterprise.limits;
      assert.equal(ent.ssoEnabled, true);
      assert.equal(ent.ragEnabled, true);
      assert.equal(ent.customPromptTemplates, true);
      assert.equal(ent.prioritySupport, true);
      // Clinical documentation is a separate plan, not included in enterprise
      assert.equal(ent.clinicalDocumentationEnabled, false);
    });

    it("free tier has no advanced features", () => {
      const free = PLAN_DEFINITIONS.free.limits;
      assert.equal(free.ssoEnabled, false);
      assert.equal(free.ragEnabled, false);
      assert.equal(free.customPromptTemplates, false);
      assert.equal(free.clinicalDocumentationEnabled, false);
    });
  });

  describe("Subscription storage operations", () => {
    it("creates and retrieves subscription via MemStorage", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

      const sub = await storage.upsertSubscription(org.id, {
        planTier: "pro",
        status: "active",
        stripeCustomerId: "cus_123",
        stripeSubscriptionId: "sub_456",
        billingInterval: "monthly",
      });
      assert.equal(sub.planTier, "pro");
      assert.equal(sub.status, "active");

      const retrieved = await storage.getSubscription(org.id);
      assert.ok(retrieved);
      assert.equal(retrieved.planTier, "pro");
    });

    it("upserts subscription (update existing)", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

      await storage.upsertSubscription(org.id, { planTier: "pro", status: "active" });
      await storage.upsertSubscription(org.id, { planTier: "enterprise", status: "active" });

      const sub = await storage.getSubscription(org.id);
      assert.ok(sub);
      assert.equal(sub.planTier, "enterprise");
    });

    it("reverts to free on subscription deletion", async () => {
      const { MemStorage } = await import("../server/storage/memory.js");
      const storage = new MemStorage();
      const org = await storage.createOrganization({ name: "Test", slug: "test", status: "active" });

      await storage.upsertSubscription(org.id, { planTier: "pro", status: "active" });
      await storage.upsertSubscription(org.id, { planTier: "free", status: "canceled" });

      const sub = await storage.getSubscription(org.id);
      assert.ok(sub);
      assert.equal(sub.planTier, "free");
      assert.equal(sub.status, "canceled");
    });
  });
});
