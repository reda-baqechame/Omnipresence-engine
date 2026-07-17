import type { SubscriptionPlan } from "@/types/database";

/**
 * Master Plan v4 packaging: three plans, hard-capped at $199. EVERY feature on
 * EVERY plan — white-label, client portal, deep reports, API/MCP, exports,
 * evidence receipts. Plans differ only in capacity (brands, prompts, monthly
 * observations, retention) defined in limits.ts. The canUse* helpers stay so
 * existing call-sites remain wired, but they always allow: features are never
 * the paywall, capacity is.
 */

export interface PlanTier {
  id: SubscriptionPlan;
  name: string;
  slug: string;
  positioning: string;
  monthlyPrice?: number;
  highlights: string[];
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "free",
    name: "Free",
    slug: "free",
    positioning: "Prove it works before paying a cent. Real measurements, real receipts.",
    monthlyPrice: 0,
    highlights: [
      "1 brand, 5 tracked prompts",
      "Weekly single-run tracking + 1 monthly evidence panel",
      "Every feature included",
      "30-day receipt retention",
    ],
  },
  {
    id: "solo",
    name: "Solo",
    slug: "solo",
    positioning: "One brand, fully measured. Every feature the $199 plan has.",
    monthlyPrice: 29,
    highlights: [
      "1 brand, 25 tracked prompts",
      "~1,500 observations / month",
      "White-label reports, API & MCP, receipts",
      "12-month receipt retention",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    slug: "growth",
    positioning: "For consultants and small teams tracking a handful of brands.",
    monthlyPrice: 79,
    highlights: [
      "5 brands, 100 prompts pooled",
      "~5,000 observations / month",
      "White-label reports, API & MCP, receipts",
      "24-month receipt retention",
    ],
  },
  {
    id: "agency",
    name: "Agency",
    slug: "agency",
    positioning: "Client-ready proof at scale — still under $200.",
    monthlyPrice: 199,
    highlights: [
      "15 brands, 300 prompts pooled",
      "~12,000 observations / month",
      "White-label reports, client portals, API & MCP",
      "Configurable retention + full evidence export",
    ],
  },
];

export function getPlanTier(plan?: SubscriptionPlan | null): PlanTier {
  return PLAN_TIERS.find((t) => t.id === (plan || "free")) || PLAN_TIERS[0];
}

/** Every plan includes deep reports — capacity is the only differentiator. */
export function canUseDeepReport(_plan?: SubscriptionPlan | null): boolean {
  return true;
}

/** Every plan includes white-label branding. */
export function canUseWhiteLabel(_plan?: SubscriptionPlan | null): boolean {
  return true;
}

/** Every plan includes client portals. */
export function canUseClientPortal(_plan?: SubscriptionPlan | null): boolean {
  return true;
}

/** Every plan includes API export. */
export function canUseApiExport(_plan?: SubscriptionPlan | null): boolean {
  return true;
}
