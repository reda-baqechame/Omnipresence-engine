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
 * Master Plan v4 pricing: every feature on every plan — ONLY capacity changes.
 * Active only when FREE_ACCESS_MODE=false, so flipping the flag turns on real
 * enforcement instantly. `Infinity` = unlimited.
 */
export interface PlanLimits {
  /** Brands/clients (projects). */
  projects: number;
  promptGeneration: number;
  /** Tracked prompts, pooled across the org's projects. */
  scanPrompts: number;
  /** Max probe cells (prompts × engines × geos × personas × runs) per panel run. */
  panelCells: number;
  /**
   * Monthly observation budget — an observation is one prompt × engine × geo ×
   * persona × run. The only real COGS driver; enforced via metering.
   */
  monthlyObservations: number;
  /**
   * Evidence/receipt retention window in days (Master Plan v4 Phase 0).
   * Receipts older than this are pruned (export-before-deletion available via
   * the evidence export endpoint). `Infinity` = keep forever/configurable.
   */
  evidenceRetentionDays: number;
}

const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  // Funnel tier, not a pricing tier: 1 brand, 5 prompts, 30-day retention.
  free: { projects: 1, promptGeneration: 50, scanPrompts: 5, panelCells: 60, monthlyObservations: 200, evidenceRetentionDays: 30 },
  // Solo $29 — 1 brand, 25 prompts, ~1,500 observations/mo, 12mo retention.
  solo: { projects: 1, promptGeneration: 150, scanPrompts: 25, panelCells: 500, monthlyObservations: 1500, evidenceRetentionDays: 365 },
  // Growth $79 — 5 brands, 100 prompts pooled, ~5,000 observations/mo, 24mo.
  growth: { projects: 5, promptGeneration: 300, scanPrompts: 100, panelCells: 1500, monthlyObservations: 5000, evidenceRetentionDays: 730 },
  // Agency $199 — 15 brands, 300 prompts pooled, ~12,000 observations/mo,
  // configurable retention + export.
  agency: { projects: 15, promptGeneration: 600, scanPrompts: 300, panelCells: 3600, monthlyObservations: 12000, evidenceRetentionDays: Infinity },
};

/**
 * Legacy DB plan values (pre-v4 enum labels) normalized onto the 3-plan model.
 * Migration 0089 remaps rows, but a cached/stale read must never crash gating.
 */
const LEGACY_PLAN_MAP: Record<string, SubscriptionPlan> = {
  audit: "solo",
  tracking: "growth",
  enterprise: "agency",
};

export function normalizePlan(plan?: string | null): SubscriptionPlan {
  if (!plan) return "free";
  if (plan in PLAN_LIMITS) return plan as SubscriptionPlan;
  return LEGACY_PLAN_MAP[plan] || "free";
}

/** Receipt retention window (days) for a plan; Infinity = never auto-pruned. */
export function getEvidenceRetentionDays(plan?: SubscriptionPlan): number {
  // While FREE_ACCESS_MODE is on, honor the most generous window so no
  // pre-launch tenant loses receipts before pricing is live.
  if (FREE_ACCESS_MODE) return PLAN_LIMITS.agency.evidenceRetentionDays;
  return getPlanLimits(plan).evidenceRetentionDays;
}

export function getPlanLimits(plan?: SubscriptionPlan): PlanLimits {
  return PLAN_LIMITS[normalizePlan(plan)];
}

/** Max probe cells allowed per panel run for this plan (the cost cap). */
export function getPanelCellLimit(plan?: SubscriptionPlan): number {
  return getPlanLimits(plan).panelCells;
}

/** Monthly observation budget (prompt × engine × geo × persona × run). */
export function getMonthlyObservationBudget(plan?: SubscriptionPlan): number {
  return getPlanLimits(plan).monthlyObservations;
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

  return normalizePlan(org?.plan as string | null);
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
      `Your ${resolvedPlan} plan allows ${limit} brand${limit === 1 ? "" : "s"}. Upgrade to add more.`
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
 * Master Plan v4: NO feature gating — every feature (including the merchant /
 * shopping engine) is available on every plan. Kept as a function so existing
 * call-sites stay wired; only capacity limits differentiate plans.
 */
export function hasMerchantAccess(_plan?: SubscriptionPlan): boolean {
  return true;
}
