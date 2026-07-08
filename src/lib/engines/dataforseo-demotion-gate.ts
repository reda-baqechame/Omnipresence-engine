/**
 * Patch J — DataForSEO fallback-only enforcement gate.
 *
 * Per the PresenceData OS plan (Section 11 / Patch J): "only after Section 9's
 * 30-day benchmark passes thresholds per capability, flip that capability's
 * DataForSEO adapter category from its current position to strictly
 * fallback_only/benchmark_only in router.ts (most already are — this patch is
 * the enforcement gate, not new plumbing)."
 *
 * Auditing `src/lib/providers/router.ts` confirms every paid, DataForSEO-
 * sourced adapter (`dataforseo` for serp, `dataforseo-backlinks` for
 * backlinks) is *already* declared `category: "fallback_only"` — there is no
 * capability today where DataForSEO is primary. So this module does not flip
 * anything; it builds the two things that were actually missing:
 *
 *  1. `auditDataForSeoCategories()` — a standing, testable invariant: any paid
 *     DataForSEO-sourced adapter found with a category OTHER than
 *     `fallback_only`/`benchmark_only` is a violation. This is the regression
 *     trap that stops a future edit from silently re-promoting DataForSEO
 *     without evidence (enforced again, redundantly, by a static text check
 *     in scripts/verify-dataforseo-fallback-only.mjs so CI catches it even
 *     without importing this module).
 *  2. `demotionReadinessReport()` — ties Patch H's real `benchmark_runs`
 *     evidence (via `summarizeBenchmarkRuns`'s `promotionReady` streak) to
 *     each capability that still has a registered DataForSEO adapter, so a
 *     human reviewer has an honest, evidence-backed answer to "has this
 *     capability earned further DataForSEO demotion?" — this module never
 *     acts on that answer automatically. Per plan rule 8 ("do not remove
 *     DataForSEO before a benchmark proves OmniData can replace that use
 *     case"), actually removing/disabling a DataForSEO adapter stays a
 *     deliberate, reviewed router.ts change — not something a nightly cron
 *     or dashboard read silently flips.
 */
import type { ParityGroupSummary } from "@/lib/engines/benchmark-dashboard";
import { PROMOTION_STREAK_DAYS } from "@/lib/engines/benchmark-dashboard";

export interface AuditableAdapter {
  id: string;
  capability: string;
  category: string;
  paid: boolean;
}

const NON_PROMOTABLE_CATEGORIES = new Set(["fallback_only", "benchmark_only"]);

/** True for adapters backed by the shared DataForSEO/OmniData-compatible client (`dataforseo.ts`) that are paid (i.e. actually hitting the paid vendor, not the sovereign OmniData backend). */
export function isPaidDataForSeoAdapter(adapter: AuditableAdapter): boolean {
  return adapter.paid && adapter.id.startsWith("dataforseo");
}

/**
 * Standing invariant: every paid DataForSEO adapter must be declared
 * fallback_only or benchmark_only, full stop — regardless of any benchmark
 * evidence. Returns one violation message per offending adapter; an empty
 * array means the invariant holds.
 */
export function auditDataForSeoCategories(adapters: AuditableAdapter[]): string[] {
  const violations: string[] = [];
  for (const adapter of adapters) {
    if (!isPaidDataForSeoAdapter(adapter)) continue;
    if (!NON_PROMOTABLE_CATEGORIES.has(adapter.category)) {
      violations.push(
        `Paid DataForSEO adapter "${adapter.id}" (capability="${adapter.capability}") has category ` +
          `"${adapter.category}" — must be "fallback_only" or "benchmark_only" until a ${PROMOTION_STREAK_DAYS}-day ` +
          `passing benchmark streak justifies otherwise (see docs/PRESENCEDATA_OS.md Patch J).`
      );
    }
  }
  return violations;
}

export interface CapabilityDemotionStatus {
  capability: string;
  /** Paid DataForSEO adapter ids currently registered for this capability. */
  dataForSeoAdapterIds: string[];
  /** True iff every registered DataForSEO adapter for this capability is already fallback_only/benchmark_only. */
  currentlyEnforced: boolean;
  /** Benchmark metric groups recorded for this capability (may be empty — no evidence yet). */
  metrics: Array<{ metricName: string; consecutivePassDays: number; promotionReady: boolean }>;
  /**
   * True only when at least one metric has been recorded AND every recorded
   * metric for this capability has cleared the PROMOTION_STREAK_DAYS bar.
   * Never true from an empty metrics list — no evidence is not evidence of
   * readiness.
   */
  evidenceSupportsFurtherDemotion: boolean;
}

/**
 * Combines the static adapter registry with real `benchmark_runs` evidence
 * (already summarized by Patch H's `summarizeBenchmarkRuns`) into a per-
 * capability status, for every capability that has at least one registered
 * paid DataForSEO adapter. Read-only / informational — see module docstring.
 */
export function demotionReadinessReport(
  adapters: AuditableAdapter[],
  benchmarkSummaries: ParityGroupSummary[]
): CapabilityDemotionStatus[] {
  const byCapability = new Map<string, AuditableAdapter[]>();
  for (const adapter of adapters) {
    if (!isPaidDataForSeoAdapter(adapter)) continue;
    const list = byCapability.get(adapter.capability);
    if (list) list.push(adapter);
    else byCapability.set(adapter.capability, [adapter]);
  }

  const statuses: CapabilityDemotionStatus[] = [];
  for (const [capability, dfsAdapters] of byCapability) {
    const metrics = benchmarkSummaries
      .filter((s) => s.capability === capability)
      .map((s) => ({
        metricName: s.metricName,
        consecutivePassDays: s.consecutivePassDays,
        promotionReady: s.promotionReady,
      }));
    statuses.push({
      capability,
      dataForSeoAdapterIds: dfsAdapters.map((a) => a.id),
      currentlyEnforced: dfsAdapters.every((a) => NON_PROMOTABLE_CATEGORIES.has(a.category)),
      metrics,
      evidenceSupportsFurtherDemotion: metrics.length > 0 && metrics.every((m) => m.promotionReady),
    });
  }

  return statuses.sort((a, b) => (a.capability < b.capability ? -1 : 1));
}
