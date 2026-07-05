"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PromptTripleMetric } from "@/lib/engines/visibility-triple-metric";
import { MetricGlossary } from "@/components/metric-glossary";

const HEADERS: Array<{ key: string; title: string; glossary?: "visibility" | "position" | "sentiment" }> = [
  { key: "prompt", title: "Prompt" },
  { key: "engine", title: "Engine" },
  { key: "visibility", title: "Visibility", glossary: "visibility" },
  { key: "position", title: "Position", glossary: "position" },
  { key: "sentiment", title: "Sentiment", glossary: "sentiment" },
  { key: "action", title: "" },
];

function promptHighlightParam(text: string): string {
  return encodeURIComponent(text.slice(0, 120));
}

function exportCsv(rows: PromptTripleMetric[]) {
  const header = "prompt,engine,visibility_pct,position,sentiment";
  const lines = rows.map((r) => {
    const prompt = `"${r.prompt.replace(/"/g, '""')}"`;
    const engine = r.engine;
    const vis = Math.round(r.visibility * 100);
    const pos = r.position ?? "";
    const sent = r.sentiment;
    return `${prompt},${engine},${vis},${pos},${sent}`;
  });
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `visibility-triple-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function VisibilityTripleTable({
  rows,
  projectId,
}: {
  rows: PromptTripleMetric[];
  projectId?: string;
}) {
  const engines = useMemo(
    () => [...new Set(rows.map((r) => r.engine))].sort(),
    [rows]
  );
  const [engineFilter, setEngineFilter] = useState<string>("all");

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No measured prompt cells yet. Run a visibility scan first.</p>;
  }

  const filtered =
    engineFilter === "all" ? rows : rows.filter((r) => r.engine === engineFilter);
  const top = [...filtered].sort((a, b) => b.visibility - a.visibility).slice(0, 25);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground flex items-center gap-2">
          Engine
          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value)}
            className="bg-background border border-input rounded-lg px-2 py-1 text-sm"
          >
            <option value="all">All engines</option>
            {engines.map((e) => (
              <option key={e} value={e}>
                {e.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => exportCsv(filtered)}
          className="text-sm px-3 py-1 rounded-lg border border-border hover:bg-secondary"
        >
          Export CSV
        </button>
        <span className="text-xs text-muted-foreground">
          Showing {top.length} of {filtered.length} cells
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              {HEADERS.map((h) => (
                <th key={h.key} className="p-3">
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
                <td className="p-3">
                  {projectId ? (
                    <Link
                      href={`/app/projects/${projectId}/prompts?highlight=${promptHighlightParam(r.prompt)}`}
                      className="text-primary text-xs hover:underline"
                    >
                      View prompt
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MetricGlossary keys={["visibility", "position", "sentiment"]} />
    </div>
  );
}
