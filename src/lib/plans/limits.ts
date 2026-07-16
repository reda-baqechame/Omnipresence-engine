import type { SubscriptionPlan } from "@/types/database";
import {
  FREE_ACCESS_MODE,
  DEFAULT_PROMPT_GENERATION_LIMIT,
  DEFAULT_VISIBILITY_SCAN_LIMIT,
  FIRST_SCAN_VISIBILITY_PROMPT_LIMIT,
} from "@/lib/config/access";

export class PlanLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitExceededError";
  }
}

/**
 * Per-plan allowances. Active only when FREE_ACCESS_MODE=false, so flipping the
 * flag turns on real enforcement instantly — no code change needed. Values are
 * intentionally generous; tune to match the published pricing tiers.
 * `Infinity` = unlimited.
 */
export interface PlanLimits {
  projects: number;
  promptGeneration: number;
  scanPrompts: number;
  /** Max probe cells (prompts × engines × geos × personas × runs) per panel run. */
  panelCells: number;
  /**
   * Evidence/receipt retention window in days (Master Plan v4 Phase 0).
   * Receipts older than this are pruned (export-before-deletion available via
   * the evidence export endpoint). `Infinity` = keep forever/configurable.
   */
  evidenceRetentionDays: number;
}

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: { projects: 1, promptGeneration: 50, scanPrompts: 25, panelCells: 60, evidenceRetentionDays: 30 },
  audit: { projects: 1, promptGeneration: 150, scanPrompts: 50, panelCells: 120, evidenceRetentionDays: 90 },
  tracking: { projects: 3, promptGeneration: 300, scanPrompts: 100, panelCells: 400, evidenceRetentionDays: 365 },
  agency: { projects: 25, promptGeneration: 500, scanPrompts: 150, panelCells: 1200, evidenceRetentionDays: 730 },
  enterprise: { projects: Infinity, promptGeneration: 1000, scanPrompts: 300, panelCells: 5000, evidenceRetentionDays: Infinity },
};

/** Receipt retention window (days) for a plan; Infinity = never auto-pruned. */
export function getEvidenceRetentionDays(plan?: SubscriptionPlan): number {
  // While FREE_ACCESS_MODE is on, honor the most generous window so no
  // pre-launch tenant loses receipts before pricing is live.
  if (FREE_ACCESS_MODE) return PLAN_LIMITS.agency.evidenceRetentionDays;
  return getPlanLimits(plan).evidenceRetentionDays;
}

export function getPlanLimits(plan?: SubscriptionPlan): PlanLimits {
  return PLAN_LIMITS[(plan || "free") as SubscriptionPlan] || PLAN_LIMITS.free;
}

/** Max probe cells allowed per panel run for this plan (the cost cap). */
export function getPanelCellLimit(plan?: SubscriptionPlan): number {
  return getPlanLimits(plan).panelCells;
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

/**
 * Enforce the per-plan project cap. No-op while FREE_ACCESS_MODE is on. When
 * enforcement is active it counts the org's existing projects and throws a
 * PlanLimitExceededError (mapped to HTTP 402) once the plan cap is reached.
 */
export async function assertProjectLimit(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  organizationId: string,
  plan?: SubscriptionPlan
): Promise<void> {
  if (FREE_ACCESS_MODE) return;

  const resolvedPlan = plan ?? (await getOrganizationPlan(supabase, organizationId));
  const limit = getPlanLimits(resolvedPlan).projects;
  if (!Number.isFinite(limit)) return;

  const { count } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if ((count ?? 0) >= limit) {
    throw new PlanLimitExceededError(
      `Your ${resolvedPlan} plan allows ${limit} project${limit === 1 ? "" : "s"}. Upgrade to add more.`
    );
  }
}

export function getPromptGenerationLimit(plan?: SubscriptionPlan): number {
  if (FREE_ACCESS_MODE) return DEFAULT_PROMPT_GENERATION_LIMIT;
  return getPlanLimits(plan).promptGeneration;
}

export function getVisibilityScanPromptLimit(plan?: SubscriptionPlan): number {
  if (FREE_ACCESS_MODE) return DEFAULT_VISIBILITY_SCAN_LIMIT;
  return getPlanLimits(plan).scanPrompts;
}

/** Cap prompt volume on the first scan so new projects complete quickly. */
export function getEffectiveVisibilityScanPromptLimit(
  plan: SubscriptionPlan | undefined,
  isFirstScan: boolean
): number {
  const limit = getVisibilityScanPromptLimit(plan);
  if (!isFirstScan) return limit;
  return Math.min(limit, FIRST_SCAN_VISIBILITY_PROMPT_LIMIT);
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
