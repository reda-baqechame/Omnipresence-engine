"use client";

import { useEffect, useState } from "react";

interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface PageRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface DecayRow {
  url: string;
  prevImpressions: number;
  currImpressions: number;
  impressionDelta: number;
  clickDelta: number;
}
interface RefreshRow {
  url: string;
  reason: string;
  priority: number;
  impressions: number;
  position: number;
}
interface Insights {
  available: boolean;
  reason?: string;
  range?: { current: { start: string; end: string } };
  totals?: { clicks: number; impressions: number; ctr: number; avgPosition: number };
  topQueries?: QueryRow[];
  topPages?: PageRow[];
  strikingDistance?: QueryRow[];
  lowCtr?: QueryRow[];
  decay?: DecayRow[];
  refreshCandidates?: RefreshRow[];
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number) => n.toLocaleString();

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function GscDashboard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/gsc?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <div className="text-sm text-muted-foreground">Loading Search Console data…</div>;

  if (!data?.available) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {data?.reason || "Google Search Console is not connected."}
        </p>
        <a
          href="/app/settings/setup"
          className="inline-block mt-3 text-sm text-primary hover:underline"
        >
          Connect Google Search Console →
        </a>
      </div>
    );
  }

  const t = data.totals!;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Last 28 days ({data.range?.current.start} → {data.range?.current.end}). Verify against your own GSC.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Clicks" value={num(t.clicks)} />
        <Stat label="Impressions" value={num(t.impressions)} />
        <Stat label="Avg CTR" value={pct(t.ctr)} />
        <Stat label="Avg Position" value={t.avgPosition.toFixed(1)} />
      </div>

      <Section title={`Striking distance (${data.strikingDistance?.length || 0})`} hint="Positions 4–20 — small pushes win page 1 / AI citations.">
        <QueryTable rows={data.strikingDistance || []} />
      </Section>

      <Section title={`Low CTR (${data.lowCtr?.length || 0})`} hint="Ranking but under-clicked — rewrite titles/meta + answer-first intros.">
        <QueryTable rows={data.lowCtr || []} />
      </Section>

      <Section title={`Content decay (${data.decay?.length || 0})`} hint="Pages losing impressions vs the prior 28 days — refresh these.">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2">Page</th>
              <th className="text-right">Prev impr.</th>
              <th className="text-right">Now</th>
              <th className="text-right">Δ impr.</th>
              <th className="text-right">Δ clicks</th>
            </tr>
          </thead>
          <tbody>
            {(data.decay || []).map((r, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-2 truncate max-w-xs">{r.url}</td>
                <td className="text-right">{num(r.prevImpressions)}</td>
                <td className="text-right">{num(r.currImpressions)}</td>
                <td className="text-right text-red-400">{num(r.impressionDelta)}</td>
                <td className="text-right">{num(r.clickDelta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Refresh candidates (${data.refreshCandidates?.length || 0})`} hint="Prioritized by opportunity across striking-distance + low-CTR + zero-click.">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2">Page</th>
              <th>Reason</th>
              <th className="text-right">Impr.</th>
              <th className="text-right">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {(data.refreshCandidates || []).map((r, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-2 truncate max-w-xs">{r.url}</td>
                <td className="text-xs text-muted-foreground">{r.reason}</td>
                <td className="text-right">{num(r.impressions)}</td>
                <td className="text-right">{r.position}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Top queries" hint="">
        <QueryTable rows={data.topQueries || []} />
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-sm">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground mb-3">{hint}</p>}
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function QueryTable({ rows }: { rows: QueryRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">None.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground border-b border-border">
          <th className="py-2">Query</th>
          <th className="text-right">Clicks</th>
          <th className="text-right">Impr.</th>
          <th className="text-right">CTR</th>
          <th className="text-right">Pos.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/50">
            <td className="py-2">{r.query}</td>
            <td className="text-right">{num(r.clicks)}</td>
            <td className="text-right">{num(r.impressions)}</td>
            <td className="text-right">{pct(r.ctr)}</td>
            <td className="text-right">{r.position.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
