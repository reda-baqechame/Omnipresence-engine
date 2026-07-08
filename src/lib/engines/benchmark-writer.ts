/**
 * PresenceData OS benchmark layer — persists a live provider-benchmark run
 * (runProviderBenchmark's real, measured sovereign-vs-paid output) into the
 * `benchmark_runs` table, applying the PresenceData OS plan's Section 9
 * thresholds so the platform has a durable, queryable comparison history
 * instead of only file-based JSON snapshots (docs/benchmarks/*.json).
 *
 * Honesty rules this module follows:
 *  - `passed` is `null` (never coerced to true/false) whenever a metric was
 *    not actually evaluated this run — no paid comparison ran, or the sample
 *    size is too small for a statistically meaningful pass/fail. A `null`
 *    here must never be read as "passed" by any downstream consumer.
 *  - The plan's "backlink referring-domain correlation" metric is a Spearman
 *    correlation; this harness only has set-overlap data (Jaccard-style),
 *    which is a lighter-weight proxy, not the same statistic. It is recorded
 *    under its own metric name and threshold_note calls out the distinction
 *    explicitly rather than silently relabeling one as the other.
 *  - No capability is promoted/demoted by this module — it only writes
 *    evidence. Promotion (Patch J) requires reading 30 consecutive days of
 *    real `passed = true` rows from this table, which is a separate,
 *    explicitly evidence-gated change to router.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BenchmarkReport, CapabilityResult } from "@/lib/engines/provider-benchmark";

export interface BenchmarkRunRow {
  capability: string;
  metric_name: string;
  sovereign_provider: string | null;
  paid_provider: string | null;
  dataset_ref: string | null;
  sovereign_value: number | null;
  paid_value: number | null;
  delta: number | null;
  passed: boolean | null;
  threshold_note: string;
}

/** Section 9 thresholds (see docs/PRESENCEDATA_OS.md / the PresenceData OS plan). */
export const FAILURE_RATE_MAX = 0.05;
export const BACKLINK_OVERLAP_MIN = 0.65;
/**
 * A pass/fail verdict on fewer samples than this is not statistically
 * meaningful — recorded as informational (passed=null) rather than a false
 * "pass" from a single lucky/unlucky call. Operators can raise the real
 * sample size via BENCHMARK_URLS/BENCHMARK_DOMAINS/BENCHMARK_QUERIES (comma
 * lists) on the nightly cron.
 */
export const MIN_SAMPLES_FOR_STATISTICAL_PASS = 10;

function datasetRef(results: CapabilityResult[]): string {
  return results.map((r) => r.input).join(",");
}

function failureRateRow(capability: string, results: CapabilityResult[]): BenchmarkRunRow | null {
  const ran = results.filter((r) => r.sovereign.ran);
  if (ran.length === 0) return null;
  const failures = ran.filter((r) => !r.sovereign.success).length;
  const rate = failures / ran.length;
  const enoughSamples = ran.length >= MIN_SAMPLES_FOR_STATISTICAL_PASS;
  return {
    capability,
    metric_name: "failure_rate",
    sovereign_provider: ran.find((r) => r.sovereign.provider)?.sovereign.provider ?? null,
    paid_provider: null,
    dataset_ref: datasetRef(results),
    sovereign_value: Number(rate.toFixed(4)),
    paid_value: null,
    delta: null,
    passed: enoughSamples ? rate <= FAILURE_RATE_MAX : null,
    threshold_note: enoughSamples
      ? `Section 9 threshold: failure rate <= ${(FAILURE_RATE_MAX * 100).toFixed(0)}% (n=${ran.length}).`
      : `Section 9 threshold: failure rate <= ${(FAILURE_RATE_MAX * 100).toFixed(0)}% — sample size n=${ran.length} is below the ${MIN_SAMPLES_FOR_STATISTICAL_PASS}-call floor for a statistically meaningful verdict; recorded as informational only (passed=null). Configure a larger BENCHMARK_URLS/DOMAINS/QUERIES list to raise n.`,
  };
}

function costPerSuccessfulResultRow(capability: string, results: CapabilityResult[]): BenchmarkRunRow | null {
  const withPaid = results.filter((r) => r.paid && r.paid.ran);
  if (withPaid.length === 0) return null;

  const sovSuccesses = results.filter((r) => r.sovereign.success).length;
  const paidSuccesses = withPaid.filter((r) => r.paid!.success).length;
  const sovTotalCost = results.reduce((s, r) => s + (r.sovereign.success ? r.sovereign.costPerCallUsd : 0), 0);
  const paidTotalCost = withPaid.reduce((s, r) => s + (r.paid!.success ? r.paid!.costPerCallUsd : 0), 0);
  const sovCostPerSuccess = sovSuccesses > 0 ? sovTotalCost / sovSuccesses : null;
  const paidCostPerSuccess = paidSuccesses > 0 ? paidTotalCost / paidSuccesses : null;

  const sovereign_provider = results.find((r) => r.sovereign.provider)?.sovereign.provider ?? null;
  const paid_provider = withPaid.find((r) => r.paid?.provider)?.paid?.provider ?? null;

  if (sovCostPerSuccess === null || paidCostPerSuccess === null) {
    return {
      capability,
      metric_name: "cost_per_successful_result",
      sovereign_provider,
      paid_provider,
      dataset_ref: datasetRef(results),
      sovereign_value: sovCostPerSuccess,
      paid_value: paidCostPerSuccess,
      delta: null,
      passed: null,
      threshold_note:
        "Section 9 threshold: cost per successful result — sovereign <= paid. Not evaluated this run: one side had zero successful calls.",
    };
  }

  return {
    capability,
    metric_name: "cost_per_successful_result",
    sovereign_provider,
    paid_provider,
    dataset_ref: datasetRef(results),
    sovereign_value: Number(sovCostPerSuccess.toFixed(6)),
    paid_value: Number(paidCostPerSuccess.toFixed(6)),
    delta: Number((paidCostPerSuccess - sovCostPerSuccess).toFixed(6)),
    passed: sovCostPerSuccess <= paidCostPerSuccess,
    threshold_note: "Section 9 threshold: cost per successful result — sovereign <= paid.",
  };
}

function backlinkOverlapRows(results: CapabilityResult[]): BenchmarkRunRow[] {
  return results
    .filter((r) => r.paid && r.overlap !== undefined)
    .map((r) => ({
      capability: "backlinks",
      metric_name: "backlink_referring_domain_overlap",
      sovereign_provider: r.sovereign.provider ?? null,
      paid_provider: r.paid!.provider ?? null,
      dataset_ref: r.input,
      sovereign_value: r.sovereign.count ?? null,
      paid_value: r.paid!.count ?? null,
      delta: Number((r.overlap as number).toFixed(4)),
      passed: (r.overlap as number) >= BACKLINK_OVERLAP_MIN,
      threshold_note: `Proxy for Section 9's "backlink referring-domain correlation >= ${BACKLINK_OVERLAP_MIN}" (a Spearman correlation vs. a paid index) — this harness measures referring-domain SET OVERLAP instead, which is a lighter-weight proxy, not the same statistic. Applying the plan's >= ${BACKLINK_OVERLAP_MIN} bar to this proxy; do not cite this row as the literal Section 9 correlation metric.`,
    }));
}

/**
 * Derives every benchmark_runs row this module can honestly compute from one
 * runProviderBenchmark() report. Intentionally does NOT invent rows for
 * Section 9 metrics this harness has no data for (SERP position delta, rank
 * repeatability, keyword volume/CPC availability, domain authority
 * correlation, PageSpeed/CrUX parity) — those require extending
 * provider-benchmark.ts itself, tracked as follow-up work, not fabricated
 * here.
 */
export function deriveBenchmarkRows(report: BenchmarkReport): BenchmarkRunRow[] {
  const rows: BenchmarkRunRow[] = [];
  const byCapability: Array<[string, CapabilityResult[]]> = [
    ["crawl", report.crawl],
    ["backlinks", report.backlinks],
    ["serp", report.serp],
    ["generate", report.generate],
  ];

  for (const [capability, results] of byCapability) {
    const fr = failureRateRow(capability, results);
    if (fr) rows.push(fr);
    const cost = costPerSuccessfulResultRow(capability, results);
    if (cost) rows.push(cost);
  }

  rows.push(...backlinkOverlapRows(report.backlinks));
  return rows;
}

export interface PersistBenchmarkRunResult {
  inserted: number;
}

/**
 * Writes every derivable row from a benchmark report into `benchmark_runs`.
 * Uses `report.finishedAt` as `run_at` so every row from one run shares an
 * exact timestamp, making "N rows per run" queries trivial.
 */
export async function persistBenchmarkRun(
  supabase: SupabaseClient,
  report: BenchmarkReport
): Promise<PersistBenchmarkRunResult> {
  const rows = deriveBenchmarkRows(report);
  if (rows.length === 0) return { inserted: 0 };

  const { error } = await supabase.from("benchmark_runs").insert(
    rows.map((r) => ({ ...r, run_at: report.finishedAt }))
  );
  if (error) throw error;
  return { inserted: rows.length };
}
