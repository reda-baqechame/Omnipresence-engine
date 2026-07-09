"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { PanelError, PanelLoading } from "@/components/panel-states";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import type { DataQuality } from "@/types/database";

const SETUP_HREF: Record<string, string> = {
  serp: "settings",
  backlinks: "backlinks",
  crawl: "technical",
  generate: "content",
  gsc: "gsc",
  attribution: "attribution",
  analytics: "attribution",
};

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
  missingProviders: Array<{ id: string; capability: string; reason: string }>;
  platform: { liveData: boolean; serpProvider?: string; configuredProviders: number };
}

export function DataTrustCenter({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TrustPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/trust`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setLoadError("Couldn't load the data trust report. Check your connection and reload."));
  }, [projectId]);

  if (loadError) return <PanelError title="Data trust report unavailable" message={loadError} />;

  if (!data) return <PanelLoading title="Loading data trust report" />;

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
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {Math.round(p.confidence * 100)}% · {p.circuit}
                  <EvidenceDrawer
                    projectId={projectId}
                    capability={p.capability}
                    target={p.id}
                    label="Proof"
                    className="text-xs"
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.missingProviders.length > 0 && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <h3 className="font-semibold mb-1">
            Missing data sources ({data.missingProviders.length})
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            Registered but not currently usable — anything measured for these capabilities falls back
            to another provider or shows as unavailable.
          </p>
          <ul className="space-y-1.5 text-sm max-h-64 overflow-y-auto">
            {data.missingProviders.map((p) => {
              const setup = SETUP_HREF[p.capability];
              return (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{p.id}</span>
                    <span className="text-muted-foreground"> · {p.capability}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-yellow-500">{p.reason}</span>
                    {setup && (
                      <Link
                        href={`/app/projects/${projectId}/${setup}`}
                        className="text-primary hover:underline whitespace-nowrap"
                      >
                        Set up
                      </Link>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
