"use client";

import { useEffect, useState } from "react";

interface BenchmarkRunRecord {
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

interface ParityGroupSummary {
  capability: string;
  metricName: string;
  latest: BenchmarkRunRecord;
  consecutivePassDays: number;
  totalDaysObserved: number;
  promotionReady: boolean;
}

interface CapabilityDemotionStatus {
  capability: string;
  dataForSeoAdapterIds: string[];
  currentlyEnforced: boolean;
  metrics: Array<{ metricName: string; consecutivePassDays: number; promotionReady: boolean }>;
  evidenceSupportsFurtherDemotion: boolean;
}

interface ParityResponse {
  lookbackDays: number;
  generatedAt: string;
  groups: ParityGroupSummary[];
  rowCount: number;
  dataForSeoDemotion?: CapabilityDemotionStatus[];
  dataForSeoCategoryViolations?: string[];
  error?: string;
}

const PROMOTION_STREAK_DAYS = 30;

function statusBadge(group: ParityGroupSummary) {
  const { passed } = group.latest;
  if (passed === true) {
    return <span className="text-green-400">pass</span>;
  }
  if (passed === false) {
    return <span className="text-red-400">fail</span>;
  }
  return <span className="text-muted-foreground">not evaluated (insufficient sample)</span>;
}

function formatValue(value: number | null): string {
  if (value === null || value === undefined) return "unavailable";
  return String(Math.round(value * 1000) / 1000);
}

export default function DataParityDashboardPage() {
  const [data, setData] = useState<ParityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/benchmark-runs");
      if (res.status === 401) {
        if (!cancelled) {
          setForbidden(true);
          setLoading(false);
        }
        return;
      }
      const json = (await res.json()) as ParityResponse;
      if (!cancelled) {
        setData(json);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="p-8">Loading parity data...</div>;

  if (forbidden) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">OmniData vs Paid-Provider Parity</h1>
        <p className="text-muted-foreground">
          You need an owner/admin role in at least one organization to view this internal dashboard.
        </p>
      </div>
    );
  }

  const groups = data?.groups || [];

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <a href="/app/ops" className="text-sm text-primary hover:underline">
          ← Ops console
        </a>
        <h1 className="text-2xl font-bold mt-2 mb-2">OmniData vs Paid-Provider Parity</h1>
        <p className="text-muted-foreground">
          Real measured results from the nightly sovereign-vs-paid benchmark cron, persisted to{" "}
          <code>benchmark_runs</code>. No metric here is a claim — it is the pass/fail outcome of an
          actual side-by-side call against the Section 9 thresholds in the PresenceData supremacy plan.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          A capability is only eligible for DataForSEO demotion (Patch J) once its parity metric shows{" "}
          {PROMOTION_STREAK_DAYS} consecutive daily passes below. A gap, a failure, or a not-evaluated
          day resets the streak to zero — there is no partial credit.
        </p>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.rowCount} runs over the last {data.lookbackDays} days · generated{" "}
          {new Date(data.generatedAt).toLocaleString()}
        </p>
      )}

      <div className="space-y-3">
        {groups.map((group) => (
          <div
            key={`${group.capability}::${group.metricName}`}
            className="bg-card border border-border rounded-xl p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">
                  {group.capability} · {group.metricName}
                </div>
                <div className="text-sm text-muted-foreground">
                  sovereign ({group.latest.sovereign_provider || "n/a"}):{" "}
                  {formatValue(group.latest.sovereign_value)} · paid ({group.latest.paid_provider || "n/a"}
                  ): {formatValue(group.latest.paid_value)} · delta {formatValue(group.latest.delta)}
                </div>
              </div>
              <div className="text-right">
                <div>{statusBadge(group)}</div>
                <div className="text-xs text-muted-foreground">
                  streak {group.consecutivePassDays}/{PROMOTION_STREAK_DAYS} days
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-2">{group.latest.threshold_note}</div>
            <div className="text-xs mt-1">
              {group.promotionReady ? (
                <span className="text-green-400">
                  Promotion-ready — {group.consecutivePassDays} consecutive passing days observed.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Not yet promotion-ready ({group.totalDaysObserved} day
                  {group.totalDaysObserved === 1 ? "" : "s"} observed in this window).
                </span>
              )}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No benchmark runs recorded yet. The nightly benchmark cron populates this view once it has
            run at least once against configured targets (BENCHMARK_URLS / BENCHMARK_DOMAINS /
            BENCHMARK_QUERIES).
          </p>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <h2 className="text-lg font-semibold mb-2">Patch J — DataForSEO fallback-only enforcement</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Every paid DataForSEO adapter registered in <code>router.ts</code> must stay{" "}
          <code>fallback_only</code>/<code>benchmark_only</code> unless the matching capability above has
          cleared a full {PROMOTION_STREAK_DAYS}-day passing streak. This section is a live read of that
          invariant — it never changes router.ts itself.
        </p>

        {data?.dataForSeoCategoryViolations && data.dataForSeoCategoryViolations.length > 0 ? (
          <div className="bg-red-950/30 border border-red-800 rounded-xl p-4 mb-4">
            <div className="font-medium text-red-400 mb-2">
              Invariant violated — DataForSEO is not fallback-only for {data.dataForSeoCategoryViolations.length}{" "}
              adapter(s):
            </div>
            <ul className="list-disc list-inside text-sm text-red-300 space-y-1">
              {data.dataForSeoCategoryViolations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-green-400 mb-4">
            Invariant holds — every paid DataForSEO adapter is currently fallback_only/benchmark_only.
          </p>
        )}

        <div className="space-y-3">
          {(data?.dataForSeoDemotion || []).map((status) => (
            <div
              key={status.capability}
              className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4"
            >
              <div>
                <div className="font-medium">{status.capability}</div>
                <div className="text-sm text-muted-foreground">
                  DataForSEO adapter(s): {status.dataForSeoAdapterIds.join(", ")}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className={status.currentlyEnforced ? "text-green-400" : "text-red-400"}>
                  {status.currentlyEnforced ? "fallback-only enforced" : "NOT fallback-only"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {status.evidenceSupportsFurtherDemotion
                    ? "Evidence supports further demotion review"
                    : `No 30-day evidence yet (${status.metrics.length} metric${status.metrics.length === 1 ? "" : "s"} tracked)`}
                </div>
              </div>
            </div>
          ))}
          {(!data?.dataForSeoDemotion || data.dataForSeoDemotion.length === 0) && (
            <p className="text-muted-foreground text-sm">
              No paid DataForSEO adapters currently registered in router.ts.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
