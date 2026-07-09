"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CapabilityRow {
  capability: string;
  sovereignAdapters: string[];
  paidFallbackAdapters: string[];
  proofState: string;
  label: string;
  consecutivePassDays: number;
  promotionReady: boolean;
  latestFailureRate: number | null;
  latestCostDelta: number | null;
  metricsObserved: number;
}

interface ProofResponse {
  generatedAt: string;
  capabilities: CapabilityRow[];
  rowCount: number;
  honestSummary: string;
  error?: string;
}

export default function ProviderProofPage() {
  const [data, setData] = useState<ProofResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/provider-proof");
      if (res.status === 401) {
        if (!cancelled) {
          setForbidden(true);
          setLoading(false);
        }
        return;
      }
      const json = await res.json();
      if (!cancelled) {
        setData(json);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="p-8">Loading provider proof…</div>;
  if (forbidden) {
    return (
      <div className="p-8 max-w-3xl space-y-2">
        <h1 className="text-2xl font-bold">Provider Proof Cockpit</h1>
        <p className="text-muted-foreground text-sm">
          Platform admin required (BENCHMARK_SECRET bearer or org owner/admin).
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Provider Proof Cockpit</h1>
        <p className="text-sm text-muted-foreground">{data?.honestSummary}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/app/ops/data-parity" className="text-primary hover:underline">
            Data parity →
          </Link>
          <Link href="/app/ops/benchmark-control" className="text-primary hover:underline">
            Benchmark control →
          </Link>
        </div>
      </header>

      <p className="text-xs text-muted-foreground">
        Rows in lookback: {data?.rowCount ?? 0} · Generated{" "}
        {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—"}
      </p>

      <div className="space-y-3">
        {(data?.capabilities || []).map((c) => (
          <div key={c.capability} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold capitalize">{c.capability}</h2>
              <span className="text-xs border border-border rounded px-2 py-0.5">{c.label}</span>
            </div>
            <dl className="mt-2 grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <dt className="font-medium text-foreground">Sovereign</dt>
                <dd>{c.sovereignAdapters.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Paid fallback</dt>
                <dd>{c.paidFallbackAdapters.join(", ") || "none"}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Streak / promo</dt>
                <dd>
                  {c.consecutivePassDays}d · {c.promotionReady ? "promotionReady" : "not ready"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Failure rate / cost Δ</dt>
                <dd>
                  {c.latestFailureRate ?? "—"} / {c.latestCostDelta ?? "—"}
                </dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
