"use client";

import { useEffect, useState } from "react";

interface ProbeTrace {
  id: string;
  engine: string;
  prompt: string;
  response_excerpt: string | null;
  brand_mentioned: boolean;
  brand_cited: boolean;
  cited_sources: string[];
  competitors_mentioned: string[];
  model: string | null;
  grounding_mode: string | null;
  confidence: number | null;
  data_source: string | null;
  checked_at: string;
}

interface CompetitorWinPrompt {
  prompt: string;
  probes: number;
  brandWins: number;
  competitorWins: number;
  lastCheckedAt: string;
}

interface TracesResponse {
  traces: ProbeTrace[];
  summary: {
    total: number;
    mentionRate: number;
    citationRate: number;
    competitorWinPrompts: CompetitorWinPrompt[];
  };
}

export function AiTracesPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TracesResponse | null>(null);
  const [engine, setEngine] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      setLoading(true);
      const qs = new URLSearchParams({ projectId, limit: "500" });
      if (engine) qs.set("engine", engine);
      try {
        const r = await fetch(`/api/ai-traces?${qs.toString()}`);
        const d = await r.json();
        if (active) setData(d);
      } finally {
        if (active) setLoading(false);
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, [projectId, engine]);

  const engines = [...new Set((data?.traces || []).map((t) => t.engine))];

  function exportCsv() {
    const qs = new URLSearchParams({ projectId, format: "csv", limit: "5000" });
    if (engine) qs.set("engine", engine);
    window.open(`/api/ai-traces?${qs.toString()}`, "_blank");
  }

  if (loading && !data) {
    return <div className="text-sm text-muted-foreground">Loading AI probe history…</div>;
  }

  const traces = data?.traces || [];
  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">AI Probe Traces</h2>
          <p className="text-sm text-muted-foreground">
            Every prompt sent to every AI engine, with win/loss outcome, cited sources, and the
            response excerpt — your refund-proof proof trail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by engine"
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All engines</option>
            {engines.map((e) => (
              <option key={e} value={e}>
                {e.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCsv}
            className="border border-border px-3 py-2 rounded-lg text-sm"
          >
            Export CSV
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-primary">{summary.total}</div>
            <div className="text-xs text-muted-foreground">Probes recorded</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-400">{Math.round(summary.mentionRate * 100)}%</div>
            <div className="text-xs text-muted-foreground">Mention rate</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-cyan-400">{Math.round(summary.citationRate * 100)}%</div>
            <div className="text-xs text-muted-foreground">Citation rate</div>
          </div>
        </div>
      )}

      {summary && summary.competitorWinPrompts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <h3 className="font-semibold text-sm text-amber-400 mb-2">
            Prompts where competitors win ({summary.competitorWinPrompts.length})
          </h3>
          <ul className="space-y-1 text-sm">
            {summary.competitorWinPrompts.slice(0, 10).map((p) => (
              <li key={p.prompt} className="flex items-center justify-between gap-3">
                <span className="truncate">{p.prompt}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {p.competitorWins}/{p.probes} probes
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              <th className="text-left p-3">When</th>
              <th className="text-left p-3">Engine</th>
              <th className="text-left p-3">Prompt</th>
              <th className="text-left p-3">Outcome</th>
              <th className="text-left p-3">Mode</th>
              <th className="text-left p-3"></th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-muted-foreground">
                  No probe traces yet. Run a visibility scan to populate this history.
                </td>
              </tr>
            ) : (
              traces.map((t) => (
                <tr key={t.id} className="border-t border-border align-top">
                  <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(t.checked_at).toLocaleDateString()}
                  </td>
                  <td className="p-3 capitalize whitespace-nowrap">{t.engine.replace(/_/g, " ")}</td>
                  <td className="p-3 max-w-sm">
                    <div className="truncate">{t.prompt}</div>
                    {expanded === t.id && t.response_excerpt && (
                      <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                        {t.response_excerpt}
                      </div>
                    )}
                    {expanded === t.id && t.cited_sources.length > 0 && (
                      <div className="mt-1 text-xs text-cyan-400">
                        Sources: {t.cited_sources.join(", ")}
                      </div>
                    )}
                    {expanded === t.id && t.competitors_mentioned.length > 0 && (
                      <div className="mt-1 text-xs text-amber-400">
                        Competitors: {t.competitors_mentioned.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {t.brand_cited ? (
                      <span className="text-cyan-400">Cited</span>
                    ) : t.brand_mentioned ? (
                      <span className="text-green-400">Mentioned</span>
                    ) : t.competitors_mentioned.length > 0 ? (
                      <span className="text-red-400">Competitor won</span>
                    ) : (
                      <span className="text-muted-foreground">Absent</span>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap text-xs text-muted-foreground">
                    {t.grounding_mode || "—"}
                    {t.model ? ` · ${t.model}` : ""}
                  </td>
                  <td className="p-3">
                    {(t.response_excerpt || t.cited_sources.length || t.competitors_mentioned.length) ? (
                      <button
                        type="button"
                        className="text-primary text-xs"
                        onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                      >
                        {expanded === t.id ? "Hide" : "Details"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
