import type { SubscriptionPlan } from "@/types/database";
import {
  FREE_ACCESS_MODE,
  DEFAULT_PROMPT_GENERATION_LIMIT,
  DEFAULT_VISIBILITY_SCAN_LIMIT,
} from "@/lib/config/access";

export class PlanLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitExceededError";
  }
}

export async function getOrganizationPlan(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  organizationId: string
): Promise<SubscriptionPlan> {
  const { data: org } = await supabase
    .from("organizations")
    .select("plan")
    .eq("id", organizationId)
    .single();

  return (org?.plan as SubscriptionPlan) || "free";
}

export async function assertProjectLimit(
  _supabase: import("@supabase/supabase-js").SupabaseClient,
  _organizationId: string,
  _plan?: SubscriptionPlan
): Promise<void> {
  if (FREE_ACCESS_MODE) return;
  throw new PlanLimitExceededError("Plan limits are enabled but not configured.");
}

export function getPromptGenerationLimit(_plan?: SubscriptionPlan): number {
  return DEFAULT_PROMPT_GENERATION_LIMIT;
}

export function getVisibilityScanPromptLimit(_plan?: SubscriptionPlan): number {
  return DEFAULT_VISIBILITY_SCAN_LIMIT;
}

/**
 * Merchant / Shopping engine is a higher-tier vertical. Honors FREE_ACCESS_MODE
 * (everything unlocked while paywalls are deferred); otherwise it's gated to
 * paid tiers. Wired now so flipping FREE_ACCESS_MODE off enforces it instantly.
 */
const MERCHANT_PLANS: SubscriptionPlan[] = ["tracking", "agency", "enterprise"];

export function hasMerchantAccess(plan?: SubscriptionPlan): boolean {
  if (FREE_ACCESS_MODE) return true;
  return plan ? MERCHANT_PLANS.includes(plan) : false;
}
