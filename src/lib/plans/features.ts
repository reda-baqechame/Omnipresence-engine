import type { SubscriptionPlan } from "@/types/database";
import { FREE_ACCESS_MODE } from "@/lib/config/access";

/**
 * Plan-feature gating. While FREE_ACCESS_MODE is on (current launch posture),
 * everything is unlocked. These helpers centralize the rules so that when
 * billing is re-enabled, gating is consistent across reports, portals, exports.
 */

const WHITE_LABEL_PLANS: SubscriptionPlan[] = ["agency", "enterprise"];
const CLIENT_PORTAL_PLANS: SubscriptionPlan[] = ["agency", "enterprise"];
const API_EXPORT_PLANS: SubscriptionPlan[] = ["tracking", "agency", "enterprise"];

const DEEP_REPORT_PLANS: SubscriptionPlan[] = ["tracking", "agency", "enterprise"];

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
