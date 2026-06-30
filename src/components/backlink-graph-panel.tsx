"use client";

import { useEffect, useState } from "react";
import { Loader2, GitBranch, TrendingUp, TrendingDown, ShieldAlert } from "lucide-react";

interface TopLink {
  source_url?: string;
  source_domain?: string;
  anchor?: string;
  nofollow?: boolean;
  domain_rank?: number | null;
  spam_risk?: number;
  link_value?: number;
}
interface IntersectionRow {
  source_domain?: string;
  links_to?: string[];
  count?: number;
  authority?: number;
  brand_gap?: boolean;
}
interface GraphData {
  available: boolean;
  reason?: string;
  latest?: {
    totalLinks: number;
    referringDomains: number;
    newCount: number;
    lostCount: number;
    toxicCount: number;
    nofollowCount: number;
    dataSource: string;
    createdAt: string;
  };
  rel?: { dofollow: number; nofollow: number };
  anchors?: { anchor: string; count: number }[];
  topLinks?: TopLink[];
  intersection?: IntersectionRow[];
  velocity?: { date: string; total: number; referringDomains: number; new: number; lost: number }[];
}

export function BacklinkGraphPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    fetch(`/api/backlink-graph?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setData(d as GraphData))
      .catch(() => setData({ available: false, reason: "Failed to load graph." }));
  }

  useEffect(load, [projectId]);

  async function refresh() {
    setRefreshing(true);
    try {
      await fetch("/api/backlink-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      load();
    } finally {
      setRefreshing(false);
    }
  }

  const l = data?.latest;
  const maxVel = Math.max(1, ...(data?.velocity || []).map((v) => v.total));
  const maxAnchor = Math.max(1, ...(data?.anchors || []).map((a) => a.count));
  const relTotal = (data?.rel?.dofollow || 0) + (data?.rel?.nofollow || 0);

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> Presence Backlink Graph
          </h3>
          <p className="text-sm text-muted-foreground">
            URL-level referring graph with new/lost velocity, anchor distribution, dofollow/nofollow split, and
            competitor link intersection. Sovereign OmniData + Common Crawl webgraph.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50 shrink-0"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          {refreshing ? "Refreshing…" : "Refresh graph"}
        </button>
      </div>

      {data && !data.available && (
        <p className="text-sm text-yellow-400">{data.reason}</p>
      )}

      {l && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Total links" value={l.totalLinks} />
            <Stat label="Referring domains" value={l.referringDomains} />
            <Stat label="New (last run)" value={l.newCount} accent="up" />
            <Stat label="Lost (last run)" value={l.lostCount} accent="down" />
            <Stat label="Toxic" value={l.toxicCount} accent="warn" />
          </div>
          <p className="text-xs text-muted-foreground">
            Source: {l.dataSource} · captured {new Date(l.createdAt).toLocaleString()}
          </p>

          {(data.velocity?.length ?? 0) > 1 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h4 className="font-medium mb-3">Link velocity</h4>
              <div className="flex items-end gap-1 h-32">
                {data.velocity!.map((v, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full bg-primary/70 rounded-t"
                      style={{ height: `${Math.round((v.total / maxVel) * 100)}%` }}
                      title={`${new Date(v.date).toLocaleDateString()}: ${v.total} links (+${v.new}/-${v.lost})`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>{new Date(data.velocity![0].date).toLocaleDateString()}</span>
                <span>{new Date(data.velocity![data.velocity!.length - 1].date).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {relTotal > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="font-medium mb-3">Dofollow / nofollow</h4>
                <div className="flex h-4 rounded overflow-hidden">
                  <div
                    className="bg-green-500"
                    style={{ width: `${Math.round((data.rel!.dofollow / relTotal) * 100)}%` }}
                    title={`${data.rel!.dofollow} dofollow`}
                  />
                  <div
                    className="bg-muted-foreground/40"
                    style={{ width: `${Math.round((data.rel!.nofollow / relTotal) * 100)}%` }}
                    title={`${data.rel!.nofollow} nofollow`}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>{data.rel!.dofollow} dofollow</span>
                  <span>{data.rel!.nofollow} nofollow</span>
                </div>
              </div>
            )}

            {(data.anchors?.length ?? 0) > 0 && (
              <div className="bg-card border border-border rounded-xl p-4">
                <h4 className="font-medium mb-3">Top anchor text</h4>
                <div className="space-y-1.5">
                  {data.anchors!.map((a) => (
                    <div key={a.anchor} className="flex items-center gap-2 text-sm">
                      <span className="w-32 truncate text-muted-foreground shrink-0" title={a.anchor}>
                        {a.anchor}
                      </span>
                      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                        <div className="h-2 bg-primary" style={{ width: `${Math.round((a.count / maxAnchor) * 100)}%` }} />
                      </div>
                      <span className="w-6 text-right tabular-nums">{a.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(data.intersection?.length ?? 0) > 0 && (
            <div className="bg-card border border-border rounded-xl p-4">
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-orange-400" /> Competitor link intersection — domains linking to
                rivals but not you
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Domain</th>
                      <th className="py-1.5 pr-3 font-medium">Links to</th>
                      <th className="py-1.5 pr-3 font-medium"># rivals</th>
                      <th className="py-1.5 pr-3 font-medium">Authority</th>
                      <th className="py-1.5 font-medium">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.intersection!.map((r, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="py-1.5 pr-3 font-medium">{r.source_domain}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[220px]">
                          {(r.links_to || []).join(", ")}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{r.count ?? 0}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{r.authority ?? "—"}</td>
                        <td className="py-1.5">
                          {r.brand_gap ? (
                            <span className="rounded px-1.5 py-0.5 text-xs bg-orange-500/15 text-orange-400">gap</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "up" | "down" | "warn" }) {
  const color =
    accent === "up" ? "text-green-400" : accent === "down" ? "text-red-400" : accent === "warn" ? "text-orange-400" : "";
  const Icon = accent === "up" ? TrendingUp : accent === "down" ? TrendingDown : null;
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold mt-1 flex items-center gap-1 ${color}`}>
        {Icon && <Icon className="h-4 w-4" />}
        {value}
      </p>
    </div>
  );
}
