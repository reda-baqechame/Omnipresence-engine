import type { SubscriptionPlan } from "@/types/database";
import { FREE_ACCESS_MODE } from "@/lib/config/access";

/**
 * Plan-feature gating. While FREE_ACCESS_MODE is on (current launch posture),
 * everything is unlocked. These helpers centralize the rules so that when
 * billing is re-enabled, gating is consistent across reports, portals, exports.
 */

export interface PlanTier {
  id: SubscriptionPlan;
  name: string;
  slug: string;
  positioning: string;
  monthlyPrice?: number;
  highlights: string[];
}

/** Four-tier packaging aligned with agency GTM (OSS → Pro → Agency → Enterprise). */
export const PLAN_TIERS: PlanTier[] = [
  {
    id: "free",
    name: "OSS / Self-Hosted",
    slug: "oss",
    positioning: "Run PresenceOS on your stack with sovereign-first providers.",
    highlights: ["Self-hosted OmniData", "Zero-paid-keys mode", "Community support"],
  },
  {
    id: "tracking",
    name: "Pro",
    slug: "pro",
    positioning: "Proof-led visibility OS for in-house SEO and growth teams.",
    monthlyPrice: 299,
    highlights: ["Deep Intelligence Reports", "Monthly AI rescans", "API export", "150 tracked prompts"],
  },
  {
    id: "agency",
    name: "Agency",
    slug: "agency",
    positioning: "White-label PresenceOS for agencies selling proof, not PDFs.",
    monthlyPrice: 999,
    highlights: ["White-label branding", "Client portal", "Unlimited projects", "300 prompts/project"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    slug: "enterprise",
    positioning: "Guarantee contracts, custom SLAs, and dedicated data residency.",
    highlights: ["Performance guarantees", "SSO & audit logs", "Dedicated support", "Custom integrations"],
  },
];

const WHITE_LABEL_PLANS: SubscriptionPlan[] = ["agency", "enterprise"];
const CLIENT_PORTAL_PLANS: SubscriptionPlan[] = ["agency", "enterprise"];
const API_EXPORT_PLANS: SubscriptionPlan[] = ["tracking", "agency", "enterprise"];

const DEEP_REPORT_PLANS: SubscriptionPlan[] = ["tracking", "agency", "enterprise"];

export function getPlanTier(plan?: SubscriptionPlan | null): PlanTier {
  return PLAN_TIERS.find((t) => t.id === (plan || "free")) || PLAN_TIERS[0];
}

export function canUseDeepReport(plan?: SubscriptionPlan | null): boolean {
  if (FREE_ACCESS_MODE) return true;
  return DEEP_REPORT_PLANS.includes((plan || "free") as SubscriptionPlan);
}

export function canUseWhiteLabel(plan?: SubscriptionPlan | null): boolean {
  if (FREE_ACCESS_MODE) return true;
  return WHITE_LABEL_PLANS.includes((plan || "free") as SubscriptionPlan);
}

export function canUseClientPortal(plan?: SubscriptionPlan | null): boolean {
  if (FREE_ACCESS_MODE) return true;
  return CLIENT_PORTAL_PLANS.includes((plan || "free") as SubscriptionPlan);
}

export function canUseApiExport(plan?: SubscriptionPlan | null): boolean {
  if (FREE_ACCESS_MODE) return true;
  return API_EXPORT_PLANS.includes((plan || "free") as SubscriptionPlan);
}
