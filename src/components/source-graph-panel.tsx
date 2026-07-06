"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectionBadge } from "@/components/projection-badge";

interface GraphNode {
  id: string;
  kind: string;
  label: string;
  influence?: number;
  sourceType?: string;
  brandCited?: boolean;
}
interface GraphEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
}
interface Graph {
  available: boolean;
  reason?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
interface Opportunity {
  source_domain: string;
  opportunity_type: string;
  competitor_citations: number;
  difficulty: number;
  influence_score: number;
  tactic: string | null;
  recommended_action: string | null;
  status: string;
  evidence: Record<string, unknown>;
}
interface Opportunities {
  available: boolean;
  reason?: string;
  opportunities: Opportunity[];
}

const COLUMN_X: Record<string, number> = { engine: 140, domain: 520, competitor: 900, brand: 900 };

function layout(nodes: GraphNode[]) {
  const cols: Record<string, GraphNode[]> = { engine: [], domain: [], target: [] };
  for (const n of nodes) {
    if (n.kind === "engine") cols.engine.push(n);
    else if (n.kind === "domain") cols.domain.push(n);
    else if (n.kind === "competitor" || n.kind === "brand") cols.target.push(n);
  }
  cols.domain.sort((a, b) => (b.influence || 0) - (a.influence || 0));
  const positions = new Map<string, { x: number; y: number; r: number }>();
  const place = (list: GraphNode[], x: number) => {
    const gap = 46;
    const startY = 40;
    list.forEach((n, i) => {
      const r = n.kind === "domain" ? 7 + Math.round((n.influence || 0) / 12) : 9;
      positions.set(n.id, { x, y: startY + i * gap, r });
    });
  };
  place(cols.engine, COLUMN_X.engine);
  place(cols.domain, COLUMN_X.domain);
  place(cols.target, COLUMN_X.competitor);
  const maxRows = Math.max(cols.engine.length, cols.domain.length, cols.target.length, 1);
  return { positions, height: 40 + maxRows * 46 + 40 };
}

function nodeColor(n: GraphNode): string {
  if (n.kind === "engine") return "#6366f1";
  if (n.kind === "brand") return "#22c55e";
  if (n.kind === "competitor") return "#ef4444";
  if (n.brandCited) return "#22c55e";
  return "#94a3b8";
}

export function SourceGraphPanel({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [opps, setOpps] = useState<Opportunities | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [msg, setMsg] = useState("");

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/source-graph?projectId=${projectId}`);
    const data = await res.json();
    setGraph(data.graph);
    setOpps(data.opportunities);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/source-graph?projectId=${projectId}`);
        const data = await res.json();
        if (cancelled) return;
        setGraph(data.graph);
        setOpps(data.opportunities);
      } catch {
        if (!cancelled) setMsg("Failed to load source graph.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function rebuild() {
    setBuilding(true);
    setMsg("");
    try {
      const res = await fetch("/api/source-graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "build" }),
      });
      const data = await res.json();
      if (data.available) {
        setMsg(`Built from measured data: ${data.domains} sources, ${data.edges} edges, ${data.opportunities} opportunities.`);
        await refetch();
      } else {
        setMsg(data.reason || "Nothing to build yet.");
      }
    } catch {
      setMsg("Build failed.");
    } finally {
      setBuilding(false);
    }
  }

  const view = useMemo(() => (graph?.nodes ? layout(graph.nodes) : null), [graph]);
  const posOf = (id: string) => view?.positions.get(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Who AI learns from in your market: every engine, the third-party domains it cites, and
          which competitors (red) or your brand (green) those sources mention. Node size = influence.
        </p>
        <button
          onClick={rebuild}
          disabled={building}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {building ? "Building…" : "Rebuild from latest scan"}
        </button>
      </div>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading source graph…</p>
      ) : !graph?.available ? (
        <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          {graph?.reason || "Source graph is empty."} Run a visibility scan, then click
          &ldquo;Rebuild from latest scan&rdquo;.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <svg width="1040" height={view?.height || 400} className="min-w-[1040px]">
            <g>
              {graph.edges.map((e, i) => {
                const a = posOf(e.from);
                const b = posOf(e.to);
                if (!a || !b) return null;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={e.type === "domain_brand" ? "#22c55e" : e.type === "domain_competitor" ? "#ef4444" : "#cbd5e1"}
                    strokeOpacity={0.4}
                    strokeWidth={1}
                  />
                );
              })}
            </g>
            <g>
              {graph.nodes.map((n) => {
                const p = posOf(n.id);
                if (!p) return null;
                const labelX = n.kind === "engine" ? p.x - p.r - 6 : p.x + p.r + 6;
                const anchor = n.kind === "engine" ? "end" : "start";
                return (
                  <g key={n.id}>
                    <circle cx={p.x} cy={p.y} r={p.r} fill={nodeColor(n)} fillOpacity={0.85} />
                    <text x={labelX} y={p.y + 4} fontSize={11} textAnchor={anchor} fill="currentColor" className="text-foreground">
                      {n.label.length > 28 ? `${n.label.slice(0, 28)}…` : n.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      <div>
        <h3 className="text-base font-semibold mb-2">Win these 3 sources first</h3>
        {!opps?.available ? (
          <p className="text-sm text-muted-foreground">{opps?.reason || "No opportunities yet."}</p>
        ) : (
          <div className="space-y-2">
            {opps.opportunities.slice(0, 3).map((o) => (
              <div key={`top-${o.source_domain}`} className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{o.source_domain}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    influence {o.influence_score}
                    <ProjectionBadge label="Est." detail="Influence score blends citation frequency and authority heuristics." />
                  </span>
                </div>
                {o.recommended_action && (
                  <p className="mt-1 text-sm text-muted-foreground">{o.recommended_action}</p>
                )}
                <button
                  type="button"
                  className="mt-2 text-xs text-primary hover:underline"
                  onClick={async () => {
                    await fetch("/api/tasks", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId,
                        title: `Outreach: earn mention on ${o.source_domain}`,
                        description: o.recommended_action,
                        sourceModule: "source_graph",
                        sourceId: o.source_domain,
                        category: "authority",
                        priority: "high",
                      }),
                    });
                    setMsg(`Task created for ${o.source_domain}`);
                  }}
                >
                  Create outreach task →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold mb-2">All ranked source opportunities</h3>
        {!opps?.available ? (
          <p className="text-sm text-muted-foreground">{opps?.reason || "No opportunities yet."}</p>
        ) : (
          <div className="space-y-2">
            {opps.opportunities.map((o) => (
              <div key={o.source_domain} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{o.source_domain}</span>
                  <span className="text-xs text-muted-foreground">
                    influence {o.influence_score} · difficulty {o.difficulty} · cited for {o.competitor_citations} competitor mention(s)
                  </span>
                </div>
                {o.recommended_action && (
                  <p className="mt-1 text-sm text-muted-foreground">{o.recommended_action}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
