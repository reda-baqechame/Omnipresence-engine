"use client";

import { useEffect, useState } from "react";
import { ProvenanceBadge } from "@/components/provenance-badge";
import type { DataQuality } from "@/types/database";

interface TrustPayload {
  dimensions: Array<{ key: string; label: string; available: boolean; status: string }>;
  dataQualityScore: { quality_score?: number; measured_signals?: number; total_signals?: number; captured_on?: string } | null;
  lastScoreAt?: string;
  scoreProvenance: { dataSource?: DataQuality; confidence?: number; provider?: string };
  signals: {
    visibility: { total: number; measured: number; status: string };
    ranks: { tracked: number; lastChecked?: string; source?: string; confidence?: number };
    attribution: { status: string; dataSource?: string; provider?: string; isEstimated?: boolean };
    gsc: { status: string; capturedOn?: string };
  };
  activeProviders: Array<{ id: string; capability: string; confidence: number; circuit: string }>;
  platform: { liveData: boolean; serpProvider?: string; configuredProviders: number };
}

export function DataTrustCenter({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TrustPayload | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/trust`)
      .then((r) => r.json())
      .then(setData);
  }, [projectId]);

  if (!data) return <p className="text-sm text-muted-foreground">Loading trust report…</p>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Platform readiness</div>
          <div className="text-lg font-semibold mt-1">{data.platform.liveData ? "Live data" : "Demo / limited"}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {data.platform.configuredProviders} providers · SERP: {data.platform.serpProvider || "none"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Data quality score</div>
          <div className="text-lg font-semibold mt-1">
            {data.dataQualityScore?.quality_score != null
              ? `${data.dataQualityScore.quality_score}/100`
              : "—"}
          </div>
          {data.dataQualityScore && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.dataQualityScore.measured_signals}/{data.dataQualityScore.total_signals} signals measured
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Latest OmniPresence scan</div>
          <div className="text-lg font-semibold mt-1 flex items-center gap-2">
            {data.lastScoreAt ? new Date(data.lastScoreAt).toLocaleDateString() : "Never"}
            {data.scoreProvenance.dataSource && (
              <ProvenanceBadge
                quality={data.scoreProvenance.dataSource}
                confidence={data.scoreProvenance.confidence}
                provider={data.scoreProvenance.provider}
              />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold mb-3">Score dimensions</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.dimensions.map((d) => (
            <div key={d.key} className="flex items-center justify-between text-sm border border-border/50 rounded-lg px-3 py-2">
              <span>{d.label}</span>
              <ProvenanceBadge quality={d.available ? "measured" : "unavailable"} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold mb-3">Signal sources</h3>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-muted-foreground">AI visibility probes</dt>
            <dd className="font-medium">
              {data.signals.visibility.measured}/{data.signals.visibility.total} measured
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rank tracking</dt>
            <dd className="font-medium">
              {data.signals.ranks.tracked} keywords
              {data.signals.ranks.source ? ` · ${data.signals.ranks.source}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Attribution</dt>
            <dd className="font-medium capitalize">{data.signals.attribution.status}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Search Console</dt>
            <dd className="font-medium capitalize">{data.signals.gsc.status}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold mb-3">Active providers</h3>
        {data.activeProviders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No live providers configured.</p>
        ) : (
          <ul className="space-y-1.5 text-sm max-h-64 overflow-y-auto">
            {data.activeProviders.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{p.id}</span>
                  <span className="text-muted-foreground"> · {p.capability}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(p.confidence * 100)}% · {p.circuit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
