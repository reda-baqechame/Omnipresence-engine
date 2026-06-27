import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { ResultsLedgerEntry } from "@/types/database";
import type { AeoLever } from "@/lib/engines/aeo-readiness";

export interface DeterministicDeliverable {
  id: string;
  name: string;
  score: number;
  met: boolean;
}

export interface TwoTierGuarantee {
  /** Tier 1 — controllable deliverables promised outright. */
  deterministicDeliverables: DeterministicDeliverable[];
  tier1Met: boolean;
  /** Tier 2 — measured aggregate citation/visibility lift (or service credit). */
  tier2Kpi: GuaranteeKpi;
  tier2Threshold: number;
}

/**
 * Build the two-tier guarantee view: deterministic levers (crawlable, schema,
 * passages, freshness) are promised outright; the measured-delta KPI is the
 * refundable Tier-2 commitment.
 */
export function buildTwoTierGuarantee(
  levers: AeoLever[],
  kpi: GuaranteeKpi = "citation_rate"
): TwoTierGuarantee {
  const deterministic = levers.filter((l) => l.type === "deterministic");
  const deliverables: DeterministicDeliverable[] = deterministic.map((l) => ({
    id: l.id,
    name: l.name,
    score: l.score,
    met: l.score >= 70,
  }));
  return {
    deterministicDeliverables: deliverables,
    tier1Met: deliverables.length > 0 && deliverables.every((d) => d.met),
    tier2Kpi: kpi,
    tier2Threshold: DEFAULT_THRESHOLDS[kpi],
  };
}

export type GuaranteeKpi =
  | "omnipresence_score"
  | "citation_rate"
  | "ai_referral_traffic"
  | "visibility_mention_rate";

export interface GuaranteeContract {
  id: string;
  project_id: string;
  kpi_metric: GuaranteeKpi;
  threshold_value: number;
  window_days: number;
  plan_tier: string;
  status: string;
  baseline_locked_at?: string;
  baseline_snapshot: Record<string, unknown>;
  verified_at?: string;
  delta_summary: Record<string, unknown>;
}

export interface GuaranteeClaim {
  id: string;
  contract_id: string;
  project_id: string;
  state: string;
  evidence: unknown[];
  remedy_type: string;
  stripe_credit_id?: string;
  credit_amount_cents?: number;
}

const DEFAULT_THRESHOLDS: Record<GuaranteeKpi, number> = {
  omnipresence_score: 15,
  citation_rate: 0.1,
  ai_referral_traffic: 50,
  visibility_mention_rate: 0.2,
};

export async function lockGuaranteeBaseline(
  supabase: SupabaseClient,
  projectId: string,
  snapshot: Record<string, unknown>,
  kpi: GuaranteeKpi = "omnipresence_score"
): Promise<GuaranteeContract | null> {
  const threshold = DEFAULT_THRESHOLDS[kpi];
  const { data, error } = await supabase
    .from("guarantee_contracts")
    .upsert(
      {
        project_id: projectId,
        kpi_metric: kpi,
        threshold_value: threshold,
        status: "active",
        baseline_locked_at: new Date().toISOString(),
        baseline_snapshot: snapshot,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" }
    )
    .select()
    .single();

  if (error) return null;
  return data as GuaranteeContract;
}

export function evaluateGuaranteeFailure(
  contract: GuaranteeContract,
  current: Record<string, number>
): { failed: boolean; delta: number; message: string; measured: boolean } {
  const baselineRaw = contract.baseline_snapshot[contract.kpi_metric];
  const nowRaw = current[contract.kpi_metric];

  // Refund-safety: we must NEVER auto-fail (and trigger a refund) on a KPI we
  // didn't actually measure this window. A missing/non-finite value means "cannot
  // verify", not "failed". Only a real measured drop below threshold fails.
  const baseline = Number(baselineRaw);
  const now = Number(nowRaw);
  const measured =
    baselineRaw !== undefined && baselineRaw !== null && Number.isFinite(baseline) &&
    nowRaw !== undefined && nowRaw !== null && Number.isFinite(now);

  if (!measured) {
    return {
      failed: false,
      delta: 0,
      measured: false,
      message: `KPI ${contract.kpi_metric} could not be measured this window — cannot verify (no auto-fail).`,
    };
  }

  const improvement = now - baseline;
  const failed = improvement < Number(contract.threshold_value);

  return {
    failed,
    delta: improvement,
    measured: true,
    message: failed
      ? `KPI ${contract.kpi_metric} improved by ${improvement.toFixed(2)} (required +${contract.threshold_value})`
      : `KPI ${contract.kpi_metric} met threshold (+${improvement.toFixed(2)})`,
  };
}

/**
 * Read the latest AEO readiness snapshot and derive Tier-1 deterministic
 * deliverable status (crawlable, schema, passages, freshness) — the part of the
 * guarantee we promise outright.
 */
export async function gatherTier1Deliverables(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ deliverables: DeterministicDeliverable[]; tier1Met: boolean }> {
  const { data } = await supabase
    .from("aeo_readiness")
    .select("levers, deterministic_deliverables_met")
    .eq("project_id", projectId)
    .maybeSingle();

  const levers = (data?.levers || []) as AeoLever[];
  if (!levers.length) {
    return { deliverables: [], tier1Met: Boolean(data?.deterministic_deliverables_met) };
  }
  const tier = buildTwoTierGuarantee(levers);
  return { deliverables: tier.deterministicDeliverables, tier1Met: tier.tier1Met };
}

/** Completed/verified ledger actions are the real evidence of work delivered. */
export async function gatherLedgerEvidence(
  supabase: SupabaseClient,
  projectId: string
): Promise<ResultsLedgerEntry[]> {
  const { data } = await supabase
    .from("results_ledger")
    .select("*")
    .eq("project_id", projectId)
    .in("status", ["completed", "verified"]);
  return (data || []) as ResultsLedgerEntry[];
}

export interface OperationalGuaranteeRecord {
  id: string;
  name: string;
  met: boolean;
  evidence: string;
}

export interface GuaranteeVerificationOptions {
  tier1Deliverables?: DeterministicDeliverable[];
  tier1Met?: boolean;
  evidence?: ResultsLedgerEntry[];
  /** Operational guarantees we cause (audit/entity/structural/GSC movement). */
  operationalGuarantees?: OperationalGuaranteeRecord[];
}

export async function verifyGuaranteeContract(
  supabase: SupabaseClient,
  projectId: string,
  currentMetrics: Record<string, number>,
  options: GuaranteeVerificationOptions = {}
): Promise<{ contract: GuaranteeContract; failed: boolean } | null> {
  const { data: contract } = await supabase
    .from("guarantee_contracts")
    .select("*")
    .eq("project_id", projectId)
    .single();

  if (!contract || !contract.baseline_locked_at) return null;

  const windowDays = Number(contract.window_days ?? 90);
  const baselineAt = new Date(contract.baseline_locked_at).getTime();
  const windowEnd = baselineAt + windowDays * 24 * 60 * 60 * 1000;
  if (Date.now() < windowEnd) {
    return { contract: contract as GuaranteeContract, failed: false };
  }

  // Tier 2 — measured aggregate KPI movement from real scans/visibility runs.
  const evaluation = evaluateGuaranteeFailure(contract as GuaranteeContract, currentMetrics);
  // Inconclusive (KPI unmeasured this window) must not mark the contract failed —
  // that would create refund liability on missing data. Keep monitoring instead.
  const status = !evaluation.measured ? "inconclusive" : evaluation.failed ? "failed" : "verified";

  const evidenceCount = options.evidence?.length ?? 0;

  await supabase
    .from("guarantee_contracts")
    .update({
      status,
      verified_at: new Date().toISOString(),
      delta_summary: {
        ...currentMetrics,
        improvement: evaluation.delta,
        threshold: contract.threshold_value,
        kpi_measured: evaluation.measured,
        message: evaluation.message,
        // Tier 1 — deterministic deliverables we promise outright.
        tier1_met: options.tier1Met ?? null,
        tier1_deliverables: options.tier1Deliverables ?? [],
        // Operational guarantees we cause and auto-verify (Phase 22).
        operational_guarantees: options.operationalGuarantees ?? [],
        operational_all_met:
          (options.operationalGuarantees?.length ?? 0) > 0
            ? options.operationalGuarantees!.every((g) => g.met)
            : null,
        // Real evidence backing the verification.
        actions_completed: evidenceCount,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  return { contract: contract as GuaranteeContract, failed: evaluation.failed };
}

export async function submitGuaranteeClaim(
  supabase: SupabaseClient,
  projectId: string,
  evidence: unknown[]
): Promise<GuaranteeClaim | null> {
  const { data: contract } = await supabase
    .from("guarantee_contracts")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", "failed")
    .single();

  if (!contract) return null;

  const { data, error } = await supabase
    .from("guarantee_claims")
    .insert({
      contract_id: contract.id,
      project_id: projectId,
      evidence,
      state: "submitted",
      remedy_type: "service_credit",
    })
    .select()
    .single();

  if (error) return null;

  await supabase
    .from("guarantee_contracts")
    .update({ status: "claimed", updated_at: new Date().toISOString() })
    .eq("id", contract.id);

  return data as GuaranteeClaim;
}

export async function approveClaimWithStripeCredit(
  supabase: SupabaseClient,
  claimId: string,
  customerId: string,
  amountCents: number
): Promise<{ success: boolean; creditId?: string; error?: string }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return { success: false, error: "Stripe not configured" };

  const stripe = new Stripe(stripeKey);

  try {
    const credit = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -amountCents,
      currency: "usd",
      description: "OmniPresence guarantee service credit",
    });

    await supabase
      .from("guarantee_claims")
      .update({
        state: "credited",
        stripe_credit_id: credit.id,
        credit_amount_cents: amountCents,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", claimId);

    return { success: true, creditId: credit.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Stripe credit failed",
    };
  }
}

export function buildGuaranteeReportFromLedger(
  entries: ResultsLedgerEntry[],
  scoreDelta: { before: number; after: number },
  trafficDelta: { before: number; after: number },
  citationDelta: { before: number; after: number }
): {
  summary: string;
  actionsCompleted: number;
  scoreChange: number;
  trafficChange: number;
  citationChange: number;
  guaranteeEligible: boolean;
  reimbursementEligible: boolean;
  evidence: ResultsLedgerEntry[];
} {
  const completed = entries.filter((e) => e.status === "completed" || e.status === "verified");
  const scoreChange = scoreDelta.after - scoreDelta.before;
  const trafficChange = trafficDelta.after - trafficDelta.before;
  const citationChange = citationDelta.after - citationDelta.before;

  const actionsMet = completed.length >= 5;
  const kpiMet = scoreChange >= 15 || citationChange >= 0.05 || trafficChange >= 50;
  const guaranteeEligible = actionsMet && !kpiMet;

  return {
    summary: `${completed.length} actions executed. Score ${scoreChange >= 0 ? "+" : ""}${scoreChange.toFixed(1)}, traffic ${trafficChange >= 0 ? "+" : ""}${trafficChange}, citations ${citationChange >= 0 ? "+" : ""}${citationChange.toFixed(2)}.`,
    actionsCompleted: completed.length,
    scoreChange,
    trafficChange,
    citationChange,
    guaranteeEligible,
    reimbursementEligible: guaranteeEligible,
    evidence: completed,
  };
}
