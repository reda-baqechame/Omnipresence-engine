"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";

const CATEGORIES = [
  "all",
  "ai_visibility",
  "content",
  "technical",
  "gsc",
  "serp",
  "authority",
  "local",
  "analytics",
  "report_quality",
] as const;

const PRIORITIES = ["all", "critical", "high", "medium", "low"] as const;

type LocalStatus = "open" | "planned" | "ignored" | "completed";

function statusKey(projectId: string) {
  return `searchops-opp-status:${projectId}`;
}

function loadStatuses(projectId: string): Record<string, LocalStatus> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(statusKey(projectId));
    return raw ? (JSON.parse(raw) as Record<string, LocalStatus>) : {};
  } catch {
    return {};
  }
}

export function OpportunitiesPanel({
  projectId,
  opportunities: initial,
}: {
  projectId: string;
  opportunities: SearchOpsOpportunity[];
}) {
  // Live GSC refresh overlays SSR snapshot; null means "use initial prop".
  const [gscOverlay, setGscOverlay] = useState<SearchOpsOpportunity[] | null>(null);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("all");
  const [impact, setImpact] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | LocalStatus>("all");
  const [statuses, setStatuses] = useState<Record<string, LocalStatus>>(() => loadStatuses(projectId));
  const [gscLoading, setGscLoading] = useState(false);
  const [gscNote, setGscNote] = useState<string | null>(null);

  const opportunities = useMemo(() => {
    if (!gscOverlay) return initial;
    const keep = initial.filter((o) => o.category !== "gsc" && o.category !== "serp");
    return [...gscOverlay, ...keep];
  }, [initial, gscOverlay]);

  function setStatus(id: string, status: LocalStatus) {
    setStatuses((prev) => {
      const next = { ...prev, [id]: status };
      try {
        localStorage.setItem(statusKey(projectId), JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }

  async function refreshGsc() {
    setGscLoading(true);
    setGscNote(null);
    try {
      const res = await fetch(`/api/searchops/gsc-opportunities?projectId=${encodeURIComponent(projectId)}`);
      const json = await res.json();
      if (!res.ok) {
        setGscNote(json.error || "GSC refresh failed");
        return;
      }
      const live = (json.opportunities || []) as SearchOpsOpportunity[];
      // Always apply returned GSC/SERP rows (includes measured rank opportunities when GSC is off).
      if (live.length) setGscOverlay(live);
      if (json.available === false) {
        setGscNote(
          json.reason ||
            "GSC not connected — first-party impressions/CTR unavailable. Rank SERP opportunities still shown when measured."
        );
        return;
      }
      setGscNote(
        json.liveGsc
          ? `Loaded ${live.length} measured GSC/SERP opportunities from Search Console.`
          : `GSC connected; using rank-tracker striking distance (${live.length}). Sync GSC for impression/CTR mining.`
      );
    } catch {
      setGscNote("GSC refresh failed");
    } finally {
      setGscLoading(false);
    }
  }

  const filtered = useMemo(() => {
    return opportunities.filter((op) => {
      if (category !== "all" && op.category !== category) return false;
      if (priority !== "all" && op.priority !== priority) return false;
      if (impact !== "all" && op.impactType !== impact) return false;
      const st = statuses[op.id] || "open";
      if (statusFilter !== "all" && st !== statusFilter) return false;
      return true;
    });
  }, [opportunities, category, priority, impact, statusFilter, statuses]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="bg-background border border-border rounded-lg text-xs px-2 py-1.5"
          value={category}
          onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              Category: {c}
            </option>
          ))}
        </select>
        <select
          className="bg-background border border-border rounded-lg text-xs px-2 py-1.5"
          value={priority}
          onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              Priority: {p}
            </option>
          ))}
        </select>
        <select
          className="bg-background border border-border rounded-lg text-xs px-2 py-1.5"
          value={impact}
          onChange={(e) => setImpact(e.target.value)}
        >
          <option value="all">Impact: all</option>
          <option value="measured">measured</option>
          <option value="estimated">estimated</option>
          <option value="unavailable">unavailable</option>
          <option value="model_knowledge">model_knowledge</option>
        </select>
        <select
          className="bg-background border border-border rounded-lg text-xs px-2 py-1.5"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | LocalStatus)}
        >
          <option value="all">Status: all</option>
          <option value="open">open</option>
          <option value="planned">planned</option>
          <option value="ignored">ignored</option>
          <option value="completed">completed</option>
        </select>
        <button
          type="button"
          onClick={() => void refreshGsc()}
          disabled={gscLoading}
          className="text-xs border border-border rounded-lg px-2.5 py-1.5 hover:bg-muted disabled:opacity-50"
        >
          {gscLoading ? "Loading GSC…" : "Refresh GSC opportunities"}
        </button>
        <span className="text-xs text-muted-foreground self-center">
          {filtered.length} / {opportunities.length}
        </span>
      </div>
      {gscNote && <p className="text-xs text-muted-foreground">{gscNote}</p>}

      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-border rounded-lg p-6 space-y-2">
          <p className="font-medium text-foreground">No opportunities match these filters.</p>
          <p>
            Professional opportunity mining needs measured inputs. Connect or sync the signals below,
            then refresh — unavailable data is never shown as zero.
          </p>
          <ul className="list-disc pl-5 text-xs space-y-1">
            <li>
              <span className="text-foreground">GSC</span> — connect Search Console, then use Refresh
              GSC for impressions, CTR, and decay.
            </li>
            <li>
              <span className="text-foreground">Ranks</span> — run rank checks for striking distance
              and cannibalization.
            </li>
            <li>
              <span className="text-foreground">Technical</span> — run technical audit / crawl for
              CWV history, schema, internal links, and canonicals.
            </li>
          </ul>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((op) => {
            const st = statuses[op.id] || "open";
            return (
              <li key={op.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase border border-border rounded px-1.5 py-0.5">
                    {op.category}
                  </span>
                  <span className="text-[10px] uppercase border border-border rounded px-1.5 py-0.5">
                    {op.priority}
                  </span>
                  <span className="text-[10px] uppercase border border-border rounded px-1.5 py-0.5">
                    effort {op.effort}
                  </span>
                  <span className="text-[10px] uppercase border border-primary/40 text-primary rounded px-1.5 py-0.5">
                    {st}
                  </span>
                  <ProvenanceBadge quality={op.impactType} />
                </div>
                <h3 className="font-medium text-sm">{op.title}</h3>
                <div className="text-xs space-y-1">
                  <p>
                    <span className="text-muted-foreground">Why this exists: </span>
                    {op.diagnosis}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Action: </span>
                    {op.recommendedAction}
                  </p>
                  <p>
                    <span className="text-muted-foreground">How we verify: </span>
                    {op.verificationPlan}
                  </p>
                  {op.impactType === "unavailable" && (
                    <p className="text-muted-foreground">
                      Unavailable because measured evidence is missing for this claim — not a zero
                      result.
                    </p>
                  )}
                  {(op.impactType === "model_knowledge" || op.impactType === "estimated") && (
                    <p className="text-muted-foreground">
                      {op.impactType === "estimated" ? "Estimated" : "Model guidance"} — do not treat
                      as a measured lift.
                    </p>
                  )}
                </div>
                {op.evidence.length > 0 && (
                  <ul className="text-[11px] text-muted-foreground space-y-0.5 border-t border-border pt-2">
                    {op.evidence.map((e, i) => (
                      <li key={i}>
                        {e.label} · {e.source} · {e.status}
                        {e.confidence != null ? ` · conf ${Math.round(e.confidence * 100)}%` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {op.limitations.length > 0 && (
                  <p className="text-[11px] text-yellow-500/90">
                    Limitations: {op.limitations.join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-3 pt-1 items-center">
                  <EvidenceDrawer
                    projectId={projectId}
                    capability={op.category}
                    target={op.id}
                    label="Why this recommendation"
                    className="text-xs"
                  />
                  <Link
                    href={`/app/projects/${projectId}/tasks`}
                    className="text-xs text-primary hover:underline"
                  >
                    Create task
                  </Link>
                  <Link
                    href={`/app/projects/${projectId}/proof-ledger`}
                    className="text-xs text-primary hover:underline"
                  >
                    Verify later
                  </Link>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setStatus(op.id, "planned")}
                  >
                    Mark planned
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setStatus(op.id, "ignored")}
                  >
                    Ignore
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setStatus(op.id, "completed")}
                  >
                    Completed
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
