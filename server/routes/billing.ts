/**
 * Billing routes: subscription management, Stripe checkout/webhooks, usage/quota.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, injectOrgContext } from "../auth";
import { logger } from "../services/logger";
import {
  getStripe, isStripeConfigured, getPriceId,
  getOrCreateCustomer, createCheckoutSession, createPortalSession,
  constructWebhookEvent,
} from "../services/stripe";
import {
  PLAN_DEFINITIONS, PLAN_TIERS,
  type PlanTier, type Subscription,
} from "@shared/schema";

// ============================================================================
// Quota Enforcement Middleware
// ============================================================================

/**
 * Check if the org has exceeded its plan limits for a given resource.
 * Returns a middleware that blocks requests if quota is exceeded.
 */
export function enforceQuota(eventType: "transcription" | "ai_analysis" | "api_call" | "storage_mb") {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = req.orgId;
    if (!orgId) return next();

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan) return next();

      const limitKey = {
        transcription: "callsPerMonth" as const,
        ai_analysis: "aiAnalysesPerMonth" as const,
        api_call: "apiCallsPerMonth" as const,
        storage_mb: "storageMb" as const,
      }[eventType];

      const limit = plan.limits[limitKey];
      if (limit === -1) return next(); // unlimited

      // Get current period usage
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const usage = await storage.getUsageSummary(orgId, periodStart);
      const used = usage.find(u => u.eventType === eventType)?.totalQuantity || 0;

      if (used >= limit) {
        return res.status(429).json({
          message: `Plan limit reached: ${used}/${limit} ${eventType} this month`,
          code: "QUOTA_EXCEEDED",
          limit,
          used,
          planTier: tier,
          upgradeUrl: "/settings?tab=billing",
        });
      }

      next();
    } catch (error) {
      logger.error({ err: error }, "Quota check failed — allowing request");
      next(); // Fail open — don't block on quota check errors
    }
  };
}

/**
 * Check max users for org based on plan tier.
 */
export function enforceUserQuota() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = req.orgId;
    if (!orgId) return next();

    try {
      const sub = await storage.getSubscription(orgId);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];
      if (!plan || plan.limits.maxUsers === -1) return next();

      const users = await storage.listUsersByOrg(orgId);
      if (users.length >= plan.limits.maxUsers) {
        return res.status(429).json({
          message: `User limit reached: ${users.length}/${plan.limits.maxUsers} users`,
          code: "USER_QUOTA_EXCEEDED",
          limit: plan.limits.maxUsers,
          used: users.length,
          planTier: tier,
        });
      }

      next();
    } catch (error) {
      next();
    }
  };
}

// ============================================================================
// Billing Routes
// ============================================================================

export function registerBillingRoutes(app: Express): void {

  // --- Plan info (public) ---
  app.get("/api/billing/plans", (_req, res) => {
    const plans = PLAN_TIERS.map(tier => ({
      tier,
      ...PLAN_DEFINITIONS[tier],
      stripeConfigured: isStripeConfigured() && !!getPriceId(tier, "monthly"),
    }));
    res.json(plans);
  });

  // --- Current subscription (authenticated) ---
  app.get("/api/billing/subscription", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const sub = await storage.getSubscription(req.orgId!);
      const tier = (sub?.planTier as PlanTier) || "free";
      const plan = PLAN_DEFINITIONS[tier];

      // Get current month's usage
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const usage = await storage.getUsageSummary(req.orgId!, periodStart);

      const usageMap: Record<string, number> = {};
      for (const u of usage) {
        usageMap[u.eventType] = u.totalQuantity;
      }

      res.json({
        subscription: sub || {
          planTier: "free",
          status: "active",
          billingInterval: "monthly",
        },
        plan,
        usage: {
          callsThisMonth: usageMap["transcription"] || 0,
          aiAnalysesThisMonth: usageMap["ai_analysis"] || 0,
          apiCallsThisMonth: usageMap["api_call"] || 0,
          storageMbUsed: usageMap["storage_mb"] || 0,
        },
        stripeConfigured: isStripeConfigured(),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get subscription" });
    }
  });

  // --- Usage history (authenticated) ---
  app.get("/api/billing/usage", requireAuth, injectOrgContext, async (req, res) => {
    try {
      const { months = "6" } = req.query;
      const numMonths = Math.min(parseInt(months as string) || 6, 12);

      const history: Array<{ month: string; usage: Record<string, number> }> = [];
      const now = new Date();

      for (let i = 0; i < numMonths; i++) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const usage = await storage.getUsageSummary(req.orgId!, start, end);

        const usageMap: Record<string, number> = {};
        for (const u of usage) usageMap[u.eventType] = u.totalQuantity;

        history.push({
          month: start.toISOString().slice(0, 7), // "2026-03"
          usage: usageMap,
        });
      }

      res.json(history.reverse()); // Chronological order
    } catch (error) {
      res.status(500).json({ message: "Failed to get usage history" });
    }
  });

  // --- Stripe Checkout (admin only) ---
  app.post("/api/billing/checkout", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    try {
      const { tier, interval = "monthly" } = req.body;
      if (!tier || !PLAN_TIERS.includes(tier)) {
        return res.status(400).json({ message: "Invalid plan tier" });
      }
      if (tier === "free") {
        return res.status(400).json({ message: "Cannot checkout for free plan" });
      }

      const priceId = getPriceId(tier as PlanTier, interval);
      if (!priceId) {
        return res.status(400).json({ message: `No Stripe price configured for ${tier}/${interval}` });
      }

      // Get or create Stripe customer
      const org = await storage.getOrganization(req.orgId!);
      const existingSub = await storage.getSubscription(req.orgId!);

      const customerId = await getOrCreateCustomer(
        stripe,
        req.orgId!,
        org?.name || "Unknown",
        req.user!.username,
        existingSub?.stripeCustomerId,
      );

      // Save customer ID if new
      if (!existingSub?.stripeCustomerId) {
        await storage.upsertSubscription(req.orgId!, {
          orgId: req.orgId!,
          planTier: existingSub?.planTier || "free",
          status: existingSub?.status || "active",
          stripeCustomerId: customerId,
          billingInterval: interval,
        });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const checkoutUrl = await createCheckoutSession(
        stripe,
        customerId,
        priceId,
        req.orgId!,
        `${baseUrl}/settings?tab=billing&checkout=success`,
        `${baseUrl}/settings?tab=billing&checkout=canceled`,
      );

      logger.info({ orgId: req.orgId, tier, interval }, "Checkout session created");
      res.json({ url: checkoutUrl });
    } catch (error) {
      logger.error({ err: error }, "Checkout session creation failed");
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  // --- Stripe Customer Portal (admin only) ---
  app.post("/api/billing/portal", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    try {
      const sub = await storage.getSubscription(req.orgId!);
      if (!sub?.stripeCustomerId) {
        return res.status(400).json({ message: "No Stripe customer found — subscribe first" });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const portalUrl = await createPortalSession(
        stripe,
        sub.stripeCustomerId,
        `${baseUrl}/settings?tab=billing`,
      );

      res.json({ url: portalUrl });
    } catch (error) {
      logger.error({ err: error }, "Portal session creation failed");
      res.status(500).json({ message: "Failed to create portal session" });
    }
  });

  // --- Downgrade to free (admin only) ---
  app.post("/api/billing/downgrade", requireAuth, requireRole("admin"), injectOrgContext, async (req, res) => {
    try {
      const sub = await storage.getSubscription(req.orgId!);

      // Cancel Stripe subscription if exists
      const stripe = getStripe();
      if (stripe && sub?.stripeSubscriptionId) {
        try {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            cancel_at_period_end: true,
          });
          await storage.updateSubscription(req.orgId!, { cancelAtPeriodEnd: true });
          return res.json({ message: "Subscription will cancel at period end" });
        } catch (err) {
          logger.error({ err }, "Failed to cancel Stripe subscription");
        }
      }

      // No Stripe — just downgrade immediately
      await storage.upsertSubscription(req.orgId!, {
        orgId: req.orgId!,
        planTier: "free",
        status: "active",
        billingInterval: "monthly",
      });

      res.json({ message: "Downgraded to free plan" });
    } catch (error) {
      res.status(500).json({ message: "Failed to downgrade" });
    }
  });

  // --- Stripe Webhook (unauthenticated — verified by signature) ---
  // NOTE: This route must use raw body parsing. The caller must configure
  // express.raw() for this path BEFORE express.json() middleware.
  app.post("/api/billing/webhook", async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured" });
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).json({ message: "Missing Stripe signature" });
    }

    let event;
    try {
      event = constructWebhookEvent(stripe, req.body, sig as string);
    } catch (err) {
      logger.error({ err }, "Webhook signature verification failed");
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as any;
          const orgId = session.metadata?.orgId;
          if (!orgId) break;

          // Retrieve full subscription from Stripe
          if (session.subscription) {
            const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
            const subData = stripeSub as any;
            const priceId = subData.items?.data?.[0]?.price?.id;
            const tier = resolveTierFromPriceId(priceId);
            const interval = subData.items?.data?.[0]?.price?.recurring?.interval === "year" ? "yearly" : "monthly";

            await storage.upsertSubscription(orgId, {
              orgId,
              planTier: tier,
              status: "active",
              stripeCustomerId: session.customer as string,
              stripeSubscriptionId: stripeSub.id,
              stripePriceId: priceId,
              billingInterval: interval,
              currentPeriodStart: new Date(subData.current_period_start * 1000).toISOString(),
              currentPeriodEnd: new Date(subData.current_period_end * 1000).toISOString(),
              cancelAtPeriodEnd: false,
            });
            logger.info({ orgId, tier, interval }, "Subscription activated via checkout");
          }
          break;
        }

        case "customer.subscription.updated": {
          const stripeSub = event.data.object as any;
          const orgId = stripeSub.metadata?.orgId;
          if (!orgId) break;

          const priceId = stripeSub.items?.data?.[0]?.price?.id;
          const tier = resolveTierFromPriceId(priceId);
          const interval = stripeSub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "yearly" : "monthly";

          const statusMap: Record<string, string> = {
            active: "active",
            past_due: "past_due",
            canceled: "canceled",
            trialing: "trialing",
            incomplete: "incomplete",
          };

          await storage.updateSubscription(orgId, {
            planTier: tier,
            status: (statusMap[stripeSub.status] || stripeSub.status) as any,
            stripePriceId: priceId,
            billingInterval: interval as any,
            currentPeriodStart: new Date(stripeSub.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(stripeSub.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
          });
          logger.info({ orgId, tier, status: stripeSub.status }, "Subscription updated");
          break;
        }

        case "customer.subscription.deleted": {
          const stripeSub = event.data.object as any;
          const orgId = stripeSub.metadata?.orgId;
          if (!orgId) break;

          await storage.upsertSubscription(orgId, {
            orgId,
            planTier: "free",
            status: "active",
            billingInterval: "monthly",
            cancelAtPeriodEnd: false,
          });
          logger.info({ orgId }, "Subscription deleted — reverted to free");
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as any;
          const customerId = invoice.customer;
          if (!customerId) break;

          const sub = await storage.getSubscriptionByStripeCustomerId(customerId);
          if (sub) {
            await storage.updateSubscription(sub.orgId, { status: "past_due" });
            logger.warn({ orgId: sub.orgId }, "Invoice payment failed — status set to past_due");
          }
          break;
        }

        default:
          logger.debug({ type: event.type }, "Unhandled Stripe event");
      }

      res.json({ received: true });
    } catch (error) {
      logger.error({ err: error, type: event.type }, "Webhook processing error");
      res.status(500).json({ message: "Webhook processing failed" });
    }
  });
}

/** Reverse-lookup a plan tier from a Stripe price ID */
function resolveTierFromPriceId(priceId?: string): PlanTier {
  if (!priceId) return "free";

  const priceMap: Record<string, PlanTier> = {};
  const proM = process.env.STRIPE_PRICE_PRO_MONTHLY;
  const proY = process.env.STRIPE_PRICE_PRO_YEARLY;
  const entM = process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY;
  const entY = process.env.STRIPE_PRICE_ENTERPRISE_YEARLY;

  if (proM) priceMap[proM] = "pro";
  if (proY) priceMap[proY] = "pro";
  if (entM) priceMap[entM] = "enterprise";
  if (entY) priceMap[entY] = "enterprise";

  return priceMap[priceId] || "pro";
}
