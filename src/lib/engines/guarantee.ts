import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import type { ResultsLedgerEntry } from "@/types/database";

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
): { failed: boolean; delta: number; message: string } {
  const baseline = Number(contract.baseline_snapshot[contract.kpi_metric] ?? 0);
  const now = Number(current[contract.kpi_metric] ?? 0);
  const delta = now - baseline;
  const improvement = delta;
  const failed = improvement < Number(contract.threshold_value);

  return {
    failed,
    delta: improvement,
    message: failed
      ? `KPI ${contract.kpi_metric} improved by ${improvement.toFixed(2)} (required +${contract.threshold_value})`
      : `KPI ${contract.kpi_metric} met threshold (+${improvement.toFixed(2)})`,
  };
}

export async function verifyGuaranteeContract(
  supabase: SupabaseClient,
  projectId: string,
  currentMetrics: Record<string, number>
): Promise<{ contract: GuaranteeContract; failed: boolean } | null> {
  const { data: contract } = await supabase
    .from("guarantee_contracts")
    .select("*")
    .eq("project_id", projectId)
    .single();

  if (!contract || !contract.baseline_locked_at) return null;

  const evaluation = evaluateGuaranteeFailure(contract as GuaranteeContract, currentMetrics);
  const status = evaluation.failed ? "failed" : "verified";

  await supabase
    .from("guarantee_contracts")
    .update({
      status,
      verified_at: new Date().toISOString(),
      delta_summary: {
        ...currentMetrics,
        improvement: evaluation.delta,
        threshold: contract.threshold_value,
        message: evaluation.message,
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
