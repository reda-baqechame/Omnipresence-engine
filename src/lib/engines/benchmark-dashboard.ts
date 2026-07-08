/**
 * Pure summarization for the OmniData-vs-paid-provider parity dashboard
 * (Patch H). Consumes rows already persisted by benchmark-writer.ts into
 * `benchmark_runs` and turns them into per-(capability, metric) summaries:
 * latest measured values, a consecutive-day pass streak, and whether that
 * streak clears the promotion bar this plan requires before Patch J may
 * demote DataForSEO for that capability.
 *
 * This module does not run benchmarks, does not call any provider, and does
 * not fabricate a verdict — a metric with no rows or only `passed: null`
 * rows never claims a streak or promotion readiness.
 */

export interface BenchmarkRunRecord {
  id: string;
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
  run_at: string;
}

export interface ParityGroupSummary {
  capability: string;
  metricName: string;
  latest: BenchmarkRunRecord;
  /** Number of distinct calendar days (UTC), most-recent-first and unbroken, where the metric passed. */
  consecutivePassDays: number;
  /** Distinct calendar days with at least one run for this metric, capped by the lookback window supplied to the query. */
  totalDaysObserved: number;
  /** True once consecutivePassDays >= PROMOTION_STREAK_DAYS. Never true for a metric that has never run or never passed. */
  promotionReady: boolean;
}

/**
 * Section 9 / Patch J bar: a capability may only be demoted from DataForSEO
 * once its OmniData parity metric has passed for this many *consecutive*
 * calendar days (not merely "N rows"), so a single lucky run or a burst of
 * same-day re-runs can't fake readiness.
 */
export const PROMOTION_STREAK_DAYS = 30;

function utcDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function groupKey(capability: string, metricName: string): string {
  return `${capability}::${metricName}`;
}

/**
 * Collapses same-day re-runs to the single latest run for that day, so a
 * cron that fires twice in one day can't count as two days of streak.
 */
function latestPerDay(rows: BenchmarkRunRecord[]): BenchmarkRunRecord[] {
  const byDay = new Map<string, BenchmarkRunRecord>();
  for (const row of rows) {
    const day = utcDateKey(row.run_at);
    const existing = byDay.get(day);
    if (!existing || row.run_at > existing.run_at) byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => (a.run_at < b.run_at ? 1 : -1));
}

/** Whole-day gap between two ISO date-only keys (b is expected to be one calendar day before a). */
function isNextDayBack(currentDay: string, previousDay: string): boolean {
  const current = new Date(`${currentDay}T00:00:00Z`);
  const previous = new Date(`${previousDay}T00:00:00Z`);
  const diffDays = Math.round((current.getTime() - previous.getTime()) / 86_400_000);
  return diffDays === 1;
}

function computeConsecutivePassDays(dailyRowsDesc: BenchmarkRunRecord[]): number {
  let streak = 0;
  for (let i = 0; i < dailyRowsDesc.length; i++) {
    const row = dailyRowsDesc[i];
    if (row.passed !== true) break;
    if (i > 0) {
      const prevDay = utcDateKey(dailyRowsDesc[i - 1].run_at);
      const thisDay = utcDateKey(row.run_at);
      if (!isNextDayBack(prevDay, thisDay)) break;
    }
    streak++;
  }
  return streak;
}

/**
 * Groups raw benchmark_runs rows by (capability, metric_name) and derives a
 * parity summary for each. Rows may arrive in any order and span multiple
 * capabilities/metrics — this is the only entry point the dashboard route
 * needs after a plain `select * from benchmark_runs order by run_at desc`.
 */
export function summarizeBenchmarkRuns(rows: BenchmarkRunRecord[]): ParityGroupSummary[] {
  const groups = new Map<string, BenchmarkRunRecord[]>();
  for (const row of rows) {
    const key = groupKey(row.capability, row.metric_name);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const summaries: ParityGroupSummary[] = [];
  for (const [, groupRows] of groups) {
    const dailyDesc = latestPerDay(groupRows);
    if (dailyDesc.length === 0) continue;
    const latest = dailyDesc[0];
    const consecutivePassDays = computeConsecutivePassDays(dailyDesc);
    summaries.push({
      capability: latest.capability,
      metricName: latest.metric_name,
      latest,
      consecutivePassDays,
      totalDaysObserved: dailyDesc.length,
      promotionReady: consecutivePassDays >= PROMOTION_STREAK_DAYS,
    });
  }

  return summaries.sort((a, b) => {
    if (a.capability !== b.capability) return a.capability < b.capability ? -1 : 1;
    return a.metricName < b.metricName ? -1 : 1;
  });
}
