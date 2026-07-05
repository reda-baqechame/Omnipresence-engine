"use client";

import type { PromptTripleMetric } from "@/lib/engines/visibility-triple-metric";
import { MetricGlossary } from "@/components/metric-glossary";

const HEADERS: Array<{ key: string; title: string; glossary?: "visibility" | "position" | "sentiment" }> = [
  { key: "prompt", title: "Prompt" },
  { key: "engine", title: "Engine" },
  { key: "visibility", title: "Visibility", glossary: "visibility" },
  { key: "position", title: "Position", glossary: "position" },
  { key: "sentiment", title: "Sentiment", glossary: "sentiment" },
];

export function VisibilityTripleTable({ rows }: { rows: PromptTripleMetric[] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No measured prompt cells yet. Run a visibility scan first.</p>;
  }

  const top = [...rows].sort((a, b) => b.visibility - a.visibility).slice(0, 25);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              {HEADERS.map((h) => (
                <th key={h.key} className="p-3" title={h.glossary ? undefined : undefined}>
                  {h.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={`${r.engine}-${r.prompt}`} className="border-b border-border/50">
                <td className="p-3 max-w-xs truncate" title={r.prompt}>{r.prompt}</td>
                <td className="p-3 capitalize">{r.engine.replace(/_/g, " ")}</td>
                <td className="p-3">{Math.round(r.visibility * 100)}%</td>
                <td className="p-3">{r.position ?? "—"}</td>
                <td className="p-3 capitalize">{r.sentiment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MetricGlossary keys={["visibility", "position", "sentiment"]} />
    </div>
  );
}
