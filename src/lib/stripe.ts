import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeInstance = new Stripe(key, {
      apiVersion: "2026-05-27.dahlia",
      typescript: true,
    });
  }
  return stripeInstance;
}

/**
 * Master Plan v4 pricing: three subscriptions, hard-capped at $199. Every
 * feature on every plan — only capacity (brands, prompts, observations,
 * retention) differs. See src/lib/plans/limits.ts for the capacity table.
 */
export const PLANS = {
  solo: {
    name: "Solo",
    price: 29,
    priceId: process.env.STRIPE_PRICE_SOLO || "price_solo",
    mode: "subscription" as const,
    features: [
      "1 brand, 25 tracked prompts",
      "~1,500 observations / month",
      "All AI engines + Google surfaces",
      "Verifiable receipts on every result",
      "White-label reports, API & MCP",
      "12-month receipt retention",
    ],
  },
  growth: {
    name: "Growth",
    price: 79,
    priceId: process.env.STRIPE_PRICE_GROWTH || "price_growth",
    mode: "subscription" as const,
    features: [
      "5 brands, 100 prompts pooled",
      "~5,000 observations / month",
      "All AI engines + Google surfaces",
      "Verifiable receipts on every result",
      "White-label reports, API & MCP",
      "24-month receipt retention",
    ],
  },
  agency: {
    name: "Agency",
    price: 199,
    priceId: process.env.STRIPE_PRICE_AGENCY || "price_agency",
    mode: "subscription" as const,
    features: [
      "15 brands, 300 prompts pooled",
      "~12,000 observations / month",
      "All AI engines + Google surfaces",
      "Client portals + white-label everything",
      "Full evidence export + configurable retention",
      "Priority support",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;
