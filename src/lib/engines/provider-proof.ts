/**
 * Provider Proof Cockpit — honest status for sovereign vs paid capabilities.
 * Never claims parity without benchmark_runs evidence.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeProviders, type AdapterStatus } from "@/lib/providers/router";
import {
  summarizeBenchmarkRuns,
  type ParityGroupSummary,
  type BenchmarkRunRecord,
} from "@/lib/engines/benchmark-dashboard";
import { demotionReadinessReport, type CapabilityDemotionStatus } from "@/lib/engines/dataforseo-demotion-gate";

export type ProofState =
  | "infrastructure_ready_no_evidence"
  | "smoke_in_progress"
  | "promotion_not_met"
  | "benchmark_proven"
  | "fallback_only"
  | "unavailable";

export interface ProviderProofCapabilityRow {
  capability: string;
  sovereignAdapters: string[];
  paidFallbackAdapters: string[];
  proofState: ProofState;
  label: string;
  consecutivePassDays: number;
  promotionReady: boolean;
  latestFailureRate: number | null;
  latestCostDelta: number | null;
  metricsObserved: number;
}

export interface ProviderProofCockpit {
  generatedAt: string;
  adapters: AdapterStatus[];
  capabilities: ProviderProofCapabilityRow[];
  demotion: CapabilityDemotionStatus[];
  rowCount: number;
  honestSummary: string;
}

function proofLabel(state: ProofState): string {
  switch (state) {
    case "infrastructure_ready_no_evidence":
      return "Infrastructure ready, no benchmark evidence yet";
    case "smoke_in_progress":
      return "7-day smoke in progress";
    case "promotion_not_met":
      return "30-day promotion not met";
    case "benchmark_proven":
      return "Benchmark-proven for this capability";
    case "fallback_only":
      return "Fallback only";
    case "unavailable":
      return "Unavailable";
  }
}

function deriveState(
  groups: ParityGroupSummary[],
  hasSovereign: boolean,
  hasPaid: boolean
): { state: ProofState; consecutivePassDays: number; promotionReady: boolean } {
  if (!hasSovereign && !hasPaid) {
    return { state: "unavailable", consecutivePassDays: 0, promotionReady: false };
  }
  if (!groups.length) {
    return {
      state: hasSovereign ? "infrastructure_ready_no_evidence" : "fallback_only",
      consecutivePassDays: 0,
      promotionReady: false,
    };
  }
  const maxStreak = Math.max(...groups.map((g) => g.consecutivePassDays), 0);
  const anyPromo = groups.some((g) => g.promotionReady);
  if (anyPromo) {
    return { state: "benchmark_proven", consecutivePassDays: maxStreak, promotionReady: true };
  }
  if (maxStreak > 0 && maxStreak < 7) {
    return { state: "smoke_in_progress", consecutivePassDays: maxStreak, promotionReady: false };
  }
  if (maxStreak >= 7) {
    return { state: "promotion_not_met", consecutivePassDays: maxStreak, promotionReady: false };
  }
  return {
    state: "infrastructure_ready_no_evidence",
    consecutivePassDays: 0,
    promotionReady: false,
  };
}

export async function loadProviderProofCockpit(
  supabase: SupabaseClient,
  lookbackDays = 45
): Promise<ProviderProofCockpit> {
  const adapters = await describeProviders();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);

  const { data: rows, error } = await supabase
    .from("benchmark_runs")
    .select("*")
    .gte("run_at", since.toISOString())
    .order("run_at", { ascending: false })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const list = (rows || []) as BenchmarkRunRecord[];
  const groups = summarizeBenchmarkRuns(list);
  const demotion = demotionReadinessReport(
    adapters.map((a) => ({
      id: a.id,
      capability: a.capability,
      category: a.category,
      paid: a.paid,
    })),
    groups
  );

  const caps = new Set(adapters.map((a) => a.capability));
  const capabilities: ProviderProofCapabilityRow[] = [...caps].sort().map((capability) => {
    const forCap = adapters.filter((a) => a.capability === capability);
    const sovereignAdapters = forCap.filter((a) => !a.paid && a.enabled).map((a) => a.id);
    const paidFallbackAdapters = forCap
      .filter((a) => a.paid && (a.category === "fallback_only" || a.category === "benchmark_only"))
      .map((a) => a.id);
    const capGroups = groups.filter((g) => g.capability === capability);
    const { state, consecutivePassDays, promotionReady } = deriveState(
      capGroups,
      sovereignAdapters.length > 0,
      paidFallbackAdapters.length > 0
    );
    const fr = capGroups.find((g) => g.metricName === "failure_rate");
    const cost = capGroups.find((g) => g.metricName === "cost_per_successful_result");
    return {
      capability,
      sovereignAdapters,
      paidFallbackAdapters,
      proofState: state,
      label: proofLabel(state),
      consecutivePassDays,
      promotionReady,
      latestFailureRate: fr?.latest.sovereign_value ?? null,
      latestCostDelta: cost?.latest.delta ?? null,
      metricsObserved: capGroups.length,
    };
  });

  const proven = capabilities.filter((c) => c.proofState === "benchmark_proven").length;
  const honestSummary =
    list.length === 0
      ? "Infrastructure ready, no benchmark evidence yet — do not claim provider parity."
      : `${proven} capability(ies) benchmark-proven; others remain infrastructure-only or promotion-not-met.`;

  return {
    generatedAt: new Date().toISOString(),
    adapters,
    capabilities,
    demotion,
    rowCount: list.length,
    honestSummary,
  };
}
