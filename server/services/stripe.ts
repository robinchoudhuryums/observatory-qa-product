/**
 * Stripe integration for subscription billing.
 *
 * Requires environment variables:
 * - STRIPE_SECRET_KEY: Stripe API secret key
 * - STRIPE_WEBHOOK_SECRET: Webhook signing secret for verifying events
 * - STRIPE_PRICE_PRO_MONTHLY: Price ID for Pro monthly plan
 * - STRIPE_PRICE_PRO_YEARLY: Price ID for Pro yearly plan
 * - STRIPE_PRICE_ENTERPRISE_MONTHLY: Price ID for Enterprise monthly plan
 * - STRIPE_PRICE_ENTERPRISE_YEARLY: Price ID for Enterprise yearly plan
 */
import Stripe from "stripe";
import { logger } from "./logger";
import type { PlanTier } from "@shared/schema";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    logger.info("[STRIPE] Not configured (set STRIPE_SECRET_KEY)");
    return null;
  }

  stripeClient = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" as any });
  logger.info("[STRIPE] Initialized");
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Map plan tier + interval to a Stripe Price ID */
export function getPriceId(tier: PlanTier, interval: "monthly" | "yearly"): string | null {
  const priceMap: Record<string, string | undefined> = {
    "pro_monthly": process.env.STRIPE_PRICE_PRO_MONTHLY,
    "pro_yearly": process.env.STRIPE_PRICE_PRO_YEARLY,
    "enterprise_monthly": process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
    "enterprise_yearly": process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
  };
  return priceMap[`${tier}_${interval}`] || null;
}

/** Create or retrieve a Stripe customer for an org */
export async function getOrCreateCustomer(
  stripe: Stripe,
  orgId: string,
  orgName: string,
  email: string,
  existingCustomerId?: string,
): Promise<string> {
  if (existingCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(existingCustomerId);
      if (!customer.deleted) return existingCustomerId;
    } catch {
      // Customer deleted or invalid — create new one
    }
  }

  const customer = await stripe.customers.create({
    name: orgName,
    email,
    metadata: { orgId },
  });

  return customer.id;
}

/** Create a Stripe Checkout session for subscription */
export async function createCheckoutSession(
  stripe: Stripe,
  customerId: string,
  priceId: string,
  orgId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { orgId },
    subscription_data: { metadata: { orgId } },
  });

  return session.url!;
}

/** Create a Stripe Customer Portal session for self-service */
export async function createPortalSession(
  stripe: Stripe,
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

/** Verify and parse a Stripe webhook event */
export function constructWebhookEvent(
  stripe: Stripe,
  body: Buffer,
  signature: string,
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured");
  }
  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}
