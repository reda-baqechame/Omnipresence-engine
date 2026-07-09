"use client";

import { useEffect, useMemo, useState } from "react";
import { PanelError } from "@/components/panel-states";
import { EvidenceDrawer } from "@/components/evidence-drawer";

interface LedgerEntry {
  id: string;
  action_type: string;
  action_surface: string | null;
  description: string;
  baseline_snapshot: Record<string, unknown> | null;
  outcome_snapshot: Record<string, unknown> | null;
  delta_summary: Record<string, unknown> | null;
  status: string;
  executed_by: string | null;
  executed_at: string;
  verified_at: string | null;
}
interface GuaranteeReport {
  summary: string;
  actionsCompleted: number;
  scoreChange: number;
  trafficChange: number;
  citationChange: number;
  guaranteeEligible: boolean;
  reimbursementEligible: boolean;
}

function StatusBadge({ status, verified }: { status: string; verified: boolean }) {
  const tone = verified || status === "verified"
    ? "bg-green-500/10 text-green-400 border-green-500/30"
    : status === "completed"
      ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
      : status === "failed"
        ? "bg-red-500/10 text-red-400 border-red-500/30"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${tone}`}>
      {verified ? "verified" : status}
    </span>
  );
}

export function ProofLedgerPanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [report, setReport] = useState<GuaranteeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [surface, setSurface] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/results-ledger?projectId=${projectId}`);
        const data = await res.json();
        if (cancelled) return;
        setEntries(data.entries || []);
        setReport(data.guaranteeReport || null);
      } catch {
        if (!cancelled) setLoadError("Couldn't load the proof ledger. Check your connection and reload.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const surfaces = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.action_surface) s.add(e.action_surface);
    return ["all", ...[...s].sort()];
  }, [entries]);

  const filtered = surface === "all" ? entries : entries.filter((e) => e.action_surface === surface);

  return (
    <div className="space-y-6">
      {loadError && <PanelError title="Proof ledger unavailable" message={loadError} />}
      {report && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Deterministic proof summary</h3>
            <span className="text-xs text-muted-foreground">{report.summary}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{report.actionsCompleted}</div>
              <div className="text-xs text-muted-foreground">Actions executed</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${report.scoreChange >= 0 ? "text-cyan-400" : "text-red-400"}`}>
                {report.scoreChange >= 0 ? "+" : ""}{report.scoreChange.toFixed(1)}
              </div>
              <div className="text-xs text-muted-foreground">Score change</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${report.trafficChange >= 0 ? "text-cyan-400" : "text-red-400"}`}>
                {report.trafficChange >= 0 ? "+" : ""}{report.trafficChange}
              </div>
              <div className="text-xs text-muted-foreground">Organic traffic change</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${report.citationChange >= 0 ? "text-cyan-400" : "text-red-400"}`}>
                {report.citationChange >= 0 ? "+" : ""}{report.citationChange.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">Citation change</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {surfaces.map((s) => (
          <button
            key={s}
            onClick={() => setSurface(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              surface === s ? "border-primary text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading proof ledger…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          No ledger entries yet. As actions are executed and verified, every one is recorded here with
          a before/after snapshot — the deterministic evidence trail behind the guarantee.
        </div>
      ) : (
        <div className="relative border-l border-border pl-6 space-y-4">
          {filtered.map((e) => {
            const verified = Boolean(e.verified_at) || e.status === "verified";
            return (
              <div key={e.id} className="relative">
                <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-primary border-2 border-background" />
                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{e.action_type}</span>
                      {e.action_surface && (
                        <span className="text-xs text-muted-foreground">· {e.action_surface}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={e.status} verified={verified} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.executed_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{e.description}</p>
                  {verified && e.verified_at && (
                    <p className="text-[11px] text-green-400 mt-1">
                      Verified {new Date(e.verified_at).toLocaleString()}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      className="text-primary text-xs"
                      onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    >
                      {expanded === e.id ? "Hide before/after" : "Before / after drill-down"}
                    </button>
                    <EvidenceDrawer
                      projectId={projectId}
                      capability={e.action_surface || e.action_type || "proof"}
                      target={e.id}
                      label="View measurement evidence"
                      className="text-xs"
                    />
                  </div>
                  {expanded === e.id && (
                    <div className="space-y-3 mt-3">
                      {e.delta_summary && Object.keys(e.delta_summary).length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase text-muted-foreground mb-1">
                            Verification delta
                          </div>
                          <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto">
                            {JSON.stringify(e.delta_summary, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[11px] uppercase text-muted-foreground mb-1">Before</div>
                          <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto">
                            {JSON.stringify(e.baseline_snapshot || {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase text-muted-foreground mb-1">After</div>
                          <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto">
                            {JSON.stringify(e.outcome_snapshot || {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
