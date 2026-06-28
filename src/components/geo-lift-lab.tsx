"use client";

import { useEffect, useState, useCallback } from "react";

interface LedgerEntry {
  id: string;
  action_type: string;
  description: string;
  status: string;
  executed_at: string;
  baseline_snapshot?: Record<string, unknown>;
  outcome_snapshot?: Record<string, unknown>;
  delta_summary?: Record<string, unknown>;
}

interface Experiment {
  id: string;
  url: string;
  status: string;
  executedAt: string;
  beforeCitationRate: number | null;
  afterCitationRate: number | null;
  citationLiftPp: number | null;
  mentionLiftPp: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toExperiments(entries: LedgerEntry[]): Experiment[] {
  return entries
    .filter((e) => e.action_type === "geo_rewrite" || e.action_type === "geo_rewrite_measured")
    .map((e) => {
      const base = e.baseline_snapshot || {};
      const out = e.outcome_snapshot || {};
      const delta = e.delta_summary || {};
      const url =
        (typeof base.url === "string" && base.url) ||
        e.description.match(/https?:\/\/[^\s;]+/)?.[0] ||
        "—";
      return {
        id: e.id,
        url,
        status: e.status,
        executedAt: e.executed_at,
        beforeCitationRate: num(base.citation_rate),
        afterCitationRate: num(out.citation_rate),
        citationLiftPp: num(delta.citation_lift_pp),
        mentionLiftPp: num(delta.mention_lift_pp),
      };
    });
}

export function GeoLiftLab({ projectId, initialEntries }: { projectId: string; initialEntries: LedgerEntry[] }) {
  const [experiments, setExperiments] = useState<Experiment[]>(toExperiments(initialEntries));
  const [url, setUrl] = useState("");
  const [waitDays, setWaitDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/results-ledger?projectId=${projectId}`);
      if (!res.ok) return;
      const data = await res.json();
      setExperiments(toExperiments(data.entries || []));
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function launch() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/geo-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, url: url.trim() || undefined, waitDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || "Could not start the experiment." });
      } else {
        setMsg({
          ok: true,
          text: `Experiment started. AutoGEO is rewriting the page; citation lift will be measured after ${waitDays} day${waitDays === 1 ? "" : "s"}.`,
        });
        setUrl("");
        setTimeout(refresh, 1500);
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const running = experiments.filter((e) => e.status === "in_progress" || e.status === "pending");
  const done = experiments.filter((e) => e.status === "verified" || e.status === "completed" || e.status === "failed");

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div>
          <h3 className="font-semibold">Run a citation-lift experiment</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            AutoGEO rewrites a page answer-first (with schema), redeploys, waits for AI engines to re-crawl, then
            re-probes and reports the <strong>measured</strong> before/after citation lift to your results ledger. This is
            what makes the guarantee defensible — real deltas, not claims.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Page URL to optimize (defaults to homepage)"
            title="Page URL to optimize"
            className="flex-1 min-w-[240px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <select
            aria-label="Days to wait before measuring lift"
            value={waitDays}
            onChange={(e) => setWaitDays(Number(e.target.value))}
            className="bg-background border border-input rounded-lg px-3 py-2 text-sm"
          >
            <option value={3}>Measure after 3 days</option>
            <option value={7}>Measure after 7 days</option>
            <option value={14}>Measure after 14 days</option>
            <option value={30}>Measure after 30 days</option>
          </select>
          <button
            type="button"
            onClick={launch}
            disabled={busy}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Starting…" : "Launch experiment"}
          </button>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-green-400" : "text-yellow-400"}`}>{msg.text}</p>}
      </div>

      {running.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">In progress ({running.length})</h3>
          <div className="space-y-2">
            {running.map((e) => (
              <div key={e.id} className="bg-card border border-border rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-3">
                <span className="truncate text-muted-foreground" title={e.url}>{e.url}</span>
                <span className="flex items-center gap-3 shrink-0">
                  {e.beforeCitationRate != null && (
                    <span className="text-muted-foreground">baseline {Math.round(e.beforeCitationRate * 100)}% cited</span>
                  )}
                  <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
                    Measuring…
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3">Measured results ({done.length})</h3>
        {done.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-6 text-center text-muted-foreground text-sm">
            No completed experiments yet. Launch one above — results appear after the measurement window.
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left p-3">Page</th>
                  <th className="text-left p-3">Before</th>
                  <th className="text-left p-3">After</th>
                  <th className="text-left p-3">Citation lift</th>
                  <th className="text-left p-3">Mention lift</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {done.map((e) => {
                  const lift = e.citationLiftPp;
                  return (
                    <tr key={e.id} className="border-t border-border">
                      <td className="p-3 max-w-[280px] truncate" title={e.url}>{e.url}</td>
                      <td className="p-3 text-muted-foreground">
                        {e.beforeCitationRate != null ? `${Math.round(e.beforeCitationRate * 100)}%` : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {e.afterCitationRate != null ? `${Math.round(e.afterCitationRate * 100)}%` : "—"}
                      </td>
                      <td className="p-3">
                        {lift == null ? "—" : (
                          <span className={lift > 0 ? "text-green-400" : lift < 0 ? "text-red-400" : "text-muted-foreground"}>
                            {lift > 0 ? "+" : ""}{lift}pp
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {e.mentionLiftPp == null ? "—" : (
                          <span className={e.mentionLiftPp > 0 ? "text-green-400" : e.mentionLiftPp < 0 ? "text-red-400" : "text-muted-foreground"}>
                            {e.mentionLiftPp > 0 ? "+" : ""}{e.mentionLiftPp}pp
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${
                          e.status === "verified"
                            ? "bg-green-500/10 text-green-400 border-green-500/30"
                            : e.status === "failed"
                              ? "bg-red-500/10 text-red-400 border-red-500/30"
                              : "bg-secondary text-muted-foreground border-border"
                        }`}>
                          {e.status === "verified" ? "Verified lift" : e.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
