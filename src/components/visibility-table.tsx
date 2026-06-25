"use client";

import type { VisibilityResult } from "@/types/database";
import { getResultDataSourceLabel } from "@/lib/engines/visibility-scanner";

interface VisibilityTableProps {
  results: VisibilityResult[];
  brandName: string;
  competitors: string[];
}

export function VisibilityTable({ results, brandName, competitors }: VisibilityTableProps) {
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
              <td className="p-3 text-xs text-muted-foreground">
                {getResultDataSourceLabel(r)}
              </td>
              <td className="p-3 text-center">{r.brand_mentioned ? "✓" : "—"}</td>
              <td className="p-3 text-center">{r.brand_cited ? "✓" : "—"}</td>
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
