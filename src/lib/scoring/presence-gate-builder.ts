import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeMinGateScore,
  gateFromRate,
  type GateScore,
  type MinGateResult,
} from "@/lib/scoring/presence-gate";
import { getConnectorHealth } from "@/lib/engines/connector-health";
import { getProductionReadiness } from "@/lib/config/production";
import { getBackedClaims, isClaimBacked, CLAIMS } from "@/lib/config/claims";

async function count(
  supabase: SupabaseClient,
  table: string,
  projectId: string,
  statusIn?: string[]
): Promise<number> {
  try {
    let q = supabase.from(table).select("*", { count: "exact", head: true }).eq("project_id", projectId);
    if (statusIn && statusIn.length) q = q.in("status", statusIn);
    const { count: c } = await q;
    return c || 0;
  } catch {
    return 0;
  }
}

/** Scale a count into a 0-1 readiness rate against a target (capped at 1). */
const rate = (n: number, target: number) => (target <= 0 ? 0 : Math.min(1, n / target));

/**
 * Build the 13 critical gates from real project data and compute the
 * minimum-gate PresenceOS Score. Each gate is honest: a gate with no data scores
 * low (not hidden), and the composite is the weakest critical capability.
 */
export async function buildPresenceGateScore(
  supabase: SupabaseClient,
  projectId: string
): Promise<MinGateResult> {
  // Latest score row carries provenance + measurement-coverage breakdown.
  const { data: latestScore } = await supabase
    .from("scores")
    .select("data_source, confidence, technical_readiness, breakdown, measured_inputs, total_inputs")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const breakdown = (latestScore?.breakdown as { dimension_coverage?: number } | null) || {};
  const dimCoverage = typeof breakdown.dimension_coverage === "number" ? breakdown.dimension_coverage : 0;
  const measuredInputs = Number(latestScore?.measured_inputs || 0);
  const totalInputs = Number(latestScore?.total_inputs || 0);

  const [
    evidenceCount,
    keywordCount,
    rankCount,
    sourceDomainCount,
    ledgerDoneCount,
    backlinkSnapCount,
  ] = await Promise.all([
    count(supabase, "ai_capture_evidence", projectId),
    count(supabase, "keyword_opportunities", projectId),
    count(supabase, "rank_snapshots", projectId),
    count(supabase, "source_domains", projectId),
    count(supabase, "results_ledger", projectId, ["completed", "verified"]),
    count(supabase, "backlink_graph_snapshots", projectId),
  ]);

  const connector = await getConnectorHealth(supabase, projectId);
  const production = getProductionReadiness();

  // Refund-safety: every advertised claim must still be backed by a real
  // capability (the honesty gate). Fraction of backed claims = refund safety.
  const backedClaims = getBackedClaims().length;
  const proofClaims = CLAIMS.filter((c) => c.category === "proof");
  const proofBacked = proofClaims.filter(isClaimBacked).length;
  const refundSafe = CLAIMS.length > 0 ? backedClaims / CLAIMS.length : 0;

  const gates: GateScore[] = [
    // Provenance: how much of the latest score is from measured (not modeled) data.
    gateFromRate(
      "provenance",
      latestScore?.data_source === "measured"
        ? Number(latestScore?.confidence || 0)
        : totalInputs > 0
          ? measuredInputs / totalInputs
          : 0,
      Boolean(latestScore),
      "Share of measured (vs modeled) inputs in the latest score"
    ),
    // Evidence: auditable artifacts captured for measured probes.
    gateFromRate("evidence", rate(evidenceCount, Math.max(1, measuredInputs || 5)), true, `${evidenceCount} evidence artifacts`),
    // Measurement: how much of the scoring surface we could actually measure.
    gateFromRate("measurement", dimCoverage, Boolean(latestScore), "Dimension coverage of the latest scan"),
    // AI capture: measured AI-engine probes present.
    gateFromRate("ai_capture", rate(measuredInputs, 6), true, `${measuredInputs} measured AI/search probes`),
    gateFromRate("keyword", rate(keywordCount, 20), true, `${keywordCount} keyword opportunities`),
    gateFromRate("rank", rate(rankCount, 10), true, `${rankCount} rank snapshots`),
    gateFromRate("backlink", rate(backlinkSnapCount, 1), true, `${backlinkSnapCount} backlink-graph snapshots`),
    gateFromRate(
      "technical",
      Number(latestScore?.technical_readiness || 0) / 100,
      Boolean(latestScore),
      "Technical readiness of the latest scan"
    ),
    gateFromRate("source_graph", rate(sourceDomainCount, 15), true, `${sourceDomainCount} source domains mapped`),
    gateFromRate("execution", rate(ledgerDoneCount, 5), true, `${ledgerDoneCount} completed/verified actions`),
    // Attribution: outcome-eligible connector health.
    gateFromRate(
      "attribution",
      connector.outcomeGuaranteeEligible ? 1 : connector.hasAnyConnection ? 0.4 : 0,
      true,
      connector.reason
    ),
    gateFromRate("production", production.score / 100, true, production.ready ? "Production ready" : production.blockers[0] || "Production not ready"),
    // Refund safety: claims backed + proof claims backed.
    gateFromRate(
      "refund_safety",
      proofClaims.length > 0 ? (refundSafe + proofBacked / proofClaims.length) / 2 : refundSafe,
      true,
      `${backedClaims}/${CLAIMS.length} claims backed`
    ),
  ];

  return computeMinGateScore(gates);
}
