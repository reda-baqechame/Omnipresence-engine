"use client";

import type { VisibilityResult } from "@/types/database";
import { resultDataQuality } from "@/lib/engines/provenance";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { EvidenceDrawer } from "@/components/evidence-drawer";

interface VisibilityTableProps {
  results: VisibilityResult[];
  brandName: string;
  competitors: string[];
  projectId?: string;
}

function sentimentIcon(s?: VisibilityResult["sentiment"]) {
  if (s === "positive") return <span className="text-green-400" title="Positive">▲</span>;
  if (s === "negative") return <span className="text-red-400" title="Negative">▼</span>;
  if (s === "neutral") return <span className="text-muted-foreground" title="Neutral">●</span>;
  return <span className="text-muted-foreground/40" title="Unknown">—</span>;
}

export function VisibilityTable({ results, brandName, competitors, projectId }: VisibilityTableProps) {
  if (results.length === 0) {
    return <p className="text-muted-foreground text-sm">No visibility results yet. Run a scan first.</p>;
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left p-3">Prompt</th>
            <th className="text-left p-3">Engine</th>
            <th className="text-left p-3">Source</th>
            <th className="text-center p-3">Brand</th>
            <th className="text-center p-3">Cited</th>
            <th className="text-center p-3" title="Sentiment of the brand mention">Sentiment</th>
            {competitors.slice(0, 3).map((c) => (
              <th key={c} className="text-center p-3">{c}</th>
            ))}
            <th className="text-left p-3">Domains</th>
          </tr>
        </thead>
        <tbody>
          {results.slice(0, 50).map((r) => (
            <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/30">
              <td className="p-3 max-w-xs truncate" title={r.prompt_text}>{r.prompt_text}</td>
              <td className="p-3 text-muted-foreground capitalize">{r.engine.replace(/_/g, " ")}</td>
              <td className="p-3 text-xs">
                <ProvenanceBadge
                  quality={resultDataQuality(r)}
                  confidence={r.confidence}
                  provider={(r.raw_response as { data_source_detail?: string } | undefined)?.data_source_detail ?? r.engine}
                  lastCheckedAt={r.last_checked_at}
                  evidenceUrl={r.evidence_url}
                />
                {projectId && r.data_source === "measured" && (
                  <EvidenceDrawer
                    projectId={projectId}
                    capability="visibility"
                    target={r.prompt_text?.slice(0, 80) || r.engine}
                    className="ml-1"
                  />
                )}
              </td>
              <td className="p-3 text-center">{r.brand_mentioned ? "✓" : "—"}</td>
              <td className="p-3 text-center">{r.brand_cited ? "✓" : "—"}</td>
              <td className="p-3 text-center">{sentimentIcon(r.sentiment)}</td>
              {competitors.slice(0, 3).map((c) => (
                <td key={c} className="p-3 text-center">
                  {r.competitor_mentions?.[c] ? "✓" : "—"}
                </td>
              ))}
              <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
                {r.source_domains?.slice(0, 3).join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
