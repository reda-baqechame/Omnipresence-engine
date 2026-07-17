"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, Play, Plus, TrendingDown, TrendingUp } from "lucide-react";
import { CopyFixButton } from "@/components/copy-fix-button";

interface SprintItem {
  title: string;
  category: "technical" | "content" | "sources";
  source: string;
  fix: string | null;
  detail: string | null;
  done: boolean;
}

interface SprintSnapshot {
  mention_rate: number;
  citation_rate: number;
  sample_size: number;
  captured_at: string;
}

interface Sprint {
  id: string;
  week_start: string;
  status: "proposed" | "active" | "measuring" | "completed" | "skipped";
  items: SprintItem[];
  baseline: SprintSnapshot | null;
  outcome: SprintSnapshot | null;
  outcome_verdict: "verified" | "increased" | "unchanged" | "declined" | "inconclusive" | null;
}

const CATEGORY_LABEL: Record<SprintItem["category"], string> = {
  technical: "Technical",
  content: "Content",
  sources: "Sources",
};

const VERDICT_STYLE: Record<string, string> = {
  increased: "bg-green-500/10 text-green-400 border-green-500/30",
  declined: "bg-red-500/10 text-red-400 border-red-500/30",
  unchanged: "bg-secondary text-muted-foreground border-border",
  inconclusive: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  verified: "bg-green-500/10 text-green-400 border-green-500/30",
};

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function SprintPanel({ projectId }: { projectId: string }) {
  const [sprints, setSprints] = useState<Sprint[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sprints?projectId=${projectId}`);
    if (res.ok) {
      const body = await res.json();
      setSprints(body.sprints || []);
    } else {
      setSprints([]);
    }
  }, [projectId]);

  useEffect(() => {
    fetch(`/api/sprints?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : { sprints: [] }))
      .then((body) => setSprints(body.sprints || []))
      .catch(() => setSprints([]));
  }, [projectId]);

  async function propose() {
    setBusy("propose");
    setError(null);
    const res = await fetch("/api/sprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error || "Could not build a sprint");
    }
    await load();
    setBusy(null);
  }

  async function patch(id: string, body: Record<string, unknown>, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    const res = await fetch(`/api/sprints/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error || "Update failed");
    }
    await load();
    setBusy(null);
  }

  if (sprints === null) {
    return <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading sprints...</div>;
  }

  const current = sprints.find((s) => s.status === "proposed" || s.status === "active" || s.status === "measuring");
  const history = sprints.filter((s) => s !== current);

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">{error}</div>
      )}

      {!current ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No sprint this week yet. Sprints are proposed automatically every Monday from your measured
            gaps — or build one now.
          </p>
          <button
            onClick={propose}
            disabled={busy === "propose"}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
          >
            {busy === "propose" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Build this week&apos;s sprint
          </button>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold">Week of {current.week_start}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {current.status === "proposed"
                  ? "Proposed — starting the sprint captures your visibility baseline."
                  : current.status === "measuring"
                    ? "Remeasuring — the panel is rerunning; the before/after verdict lands when it finishes."
                    : `Active since ${current.baseline ? new Date(current.baseline.captured_at).toLocaleDateString() : "start"} — baseline: ${current.baseline ? `${pct(current.baseline.mention_rate)} mentions / ${pct(current.baseline.citation_rate)} citations over ${current.baseline.sample_size} measured answers` : "—"}`}
              </div>
            </div>
            {current.status === "proposed" ? (
              <button
                onClick={() => patch(current.id, { action: "start" }, "start")}
                disabled={busy === "start"}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start sprint
              </button>
            ) : current.status === "measuring" ? (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 shrink-0">
                <Loader2 className="h-4 w-4 animate-spin" /> Measuring
              </span>
            ) : (
              <button
                onClick={() => patch(current.id, { action: "complete" }, "complete")}
                disabled={busy === "complete"}
                className="border border-border px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 hover:border-primary disabled:opacity-50 shrink-0"
              >
                {busy === "complete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Complete &amp; measure
              </button>
            )}
          </div>

          <div className="space-y-2">
            {current.items.map((item, i) => (
              <div key={`${item.title}-${i}`} className="bg-background border border-border rounded-lg p-3">
                <div className="flex items-start gap-2.5">
                  <button
                    onClick={() => patch(current.id, { toggleItemIndex: i }, `item-${i}`)}
                    disabled={busy === `item-${i}` || current.status === "proposed"}
                    className="mt-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                    title={item.done ? "Mark not done" : "Mark done"}
                    aria-label={item.done ? "Mark not done" : "Mark done"}
                  >
                    {item.done ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${item.done ? "line-through text-muted-foreground" : ""}`}>{item.title}</span>
                      <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-secondary text-muted-foreground shrink-0">
                        {CATEGORY_LABEL[item.category]}
                      </span>
                    </div>
                    {item.detail && <p className="text-xs text-muted-foreground mt-1">{item.detail}</p>}
                    {item.fix && (
                      <div className="mt-2 flex items-start gap-2 bg-card border border-border rounded-lg p-2.5">
                        <p className="text-xs flex-1 whitespace-pre-wrap">{item.fix}</p>
                        <CopyFixButton text={item.fix} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Sprint history</h3>
          <div className="space-y-2">
            {history.map((s) => {
              const mentionDelta = s.baseline && s.outcome ? (s.outcome.mention_rate - s.baseline.mention_rate) * 100 : null;
              const citationDelta = s.baseline && s.outcome ? (s.outcome.citation_rate - s.baseline.citation_rate) * 100 : null;
              return (
                <div key={s.id} className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">Week of {s.week_start}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {s.items.filter((i) => i.done).length}/{s.items.length} items done
                      {mentionDelta !== null && citationDelta !== null && (
                        <>
                          {" · mentions "}
                          {mentionDelta >= 0 ? "+" : ""}{mentionDelta.toFixed(1)}pp
                          {" · citations "}
                          {citationDelta >= 0 ? "+" : ""}{citationDelta.toFixed(1)}pp
                        </>
                      )}
                    </div>
                  </div>
                  {s.outcome_verdict ? (
                    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2.5 py-1 ${VERDICT_STYLE[s.outcome_verdict] || VERDICT_STYLE.unchanged}`}>
                      {s.outcome_verdict === "increased" && <TrendingUp className="h-3.5 w-3.5" />}
                      {s.outcome_verdict === "declined" && <TrendingDown className="h-3.5 w-3.5" />}
                      {s.outcome_verdict}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{s.status}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
