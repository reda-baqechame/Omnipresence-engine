"use client";

import { MetricGlossary } from "@/components/metric-glossary";

export interface PopularityTrendPoint {
  label: string;
  pageRank?: number;
  harmonicCentrality?: number;
}

export interface PopularityDomainRow {
  domain: string;
  label: string;
  isBrand?: boolean;
  trancoRank?: number;
  globalRank?: number;
  authorityScore: number;
  authoritySource: string;
  pageRankNorm?: number;
  trend?: PopularityTrendPoint[];
  cruxRank?: number;
}

export function PopularityPanel({
  rows,
  note = "Relative popularity index (0–100) from Tranco, rank.to, Common Crawl WebGraph PageRank, and Open PageRank — NOT visit counts.",
}: {
  rows: PopularityDomainRow[];
  note?: string;
}) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No popularity signals resolved yet.</p>;
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border bg-muted/30">
        <h3 className="font-semibold">Popularity & Traffic Rank</h3>
        <p className="text-xs text-muted-foreground mt-1">{note}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="p-3">Domain</th>
              <th className="p-3 text-right">Index</th>
              <th className="p-3 text-right">Tranco</th>
              <th className="p-3 text-right">Global rank</th>
              <th className="p-3 text-right">CC PageRank</th>
              <th className="p-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.domain} className="border-b border-border/50">
                <td className="p-3">
                  <span className={r.isBrand ? "font-semibold text-primary" : ""}>{r.label}</span>
                  <div className="text-xs text-muted-foreground">{r.domain}</div>
                </td>
                <td className="p-3 text-right tabular-nums">{r.authorityScore > 0 ? `${r.authorityScore}/100` : "—"}</td>
                <td className="p-3 text-right tabular-nums">
                  {typeof r.trancoRank === "number" ? `#${r.trancoRank.toLocaleString()}` : "—"}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {typeof r.globalRank === "number" ? `#${r.globalRank.toLocaleString()}` : "—"}
                </td>
                <td className="p-3 text-right tabular-nums">
                  {typeof r.pageRankNorm === "number" ? r.pageRankNorm.toFixed(1) : "—"}
                </td>
                <td className="p-3 text-xs text-muted-foreground capitalize">{r.authoritySource.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => (r.trend?.length ?? 0) > 1) && (
        <div className="p-4 border-t border-border text-xs text-muted-foreground">
          PageRank history available for {rows.filter((r) => (r.trend?.length ?? 0) > 1).length} domain(s) via Common Crawl WebGraph.
        </div>
      )}
      <div className="p-4 border-t border-border">
        <MetricGlossary keys={["popularity_index"]} />
      </div>
    </div>
  );
}
