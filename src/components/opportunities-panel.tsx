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

export function OpportunitiesPanel({
  projectId,
  opportunities,
}: {
  projectId: string;
  opportunities: SearchOpsOpportunity[];
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("all");
  const [impact, setImpact] = useState<string>("all");

  const filtered = useMemo(() => {
    return opportunities.filter((op) => {
      if (category !== "all" && op.category !== category) return false;
      if (priority !== "all" && op.priority !== priority) return false;
      if (impact !== "all" && op.impactType !== impact) return false;
      return true;
    });
  }, [opportunities, category, priority, impact]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
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
        <span className="text-xs text-muted-foreground self-center">
          {filtered.length} / {opportunities.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-border rounded-lg p-6">
          No opportunities match these filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((op) => (
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
                <ProvenanceBadge quality={op.impactType} />
              </div>
              <h3 className="font-medium text-sm">{op.title}</h3>
              <p className="text-xs text-muted-foreground">{op.diagnosis}</p>
              <div className="text-xs space-y-1">
                <p>
                  <span className="text-muted-foreground">Action: </span>
                  {op.recommendedAction}
                </p>
                <p>
                  <span className="text-muted-foreground">Verification plan: </span>
                  {op.verificationPlan}
                </p>
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
                <p className="text-[11px] text-yellow-500/90">Limitations: {op.limitations.join(" · ")}</p>
              )}
              <div className="flex flex-wrap gap-3 pt-1">
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
