"use client";

type ExportType =
  | "ranks"
  | "keywords"
  | "findings"
  | "ledger"
  | "visibility"
  | "backlinks"
  | "coverage"
  | "mentions"
  | "snippets"
  | "tasks"
  | "content_gaps"
  | "local";

const LABELS: Record<ExportType, string> = {
  ranks: "Ranks",
  keywords: "Keywords",
  findings: "Findings",
  ledger: "Activity",
  visibility: "AI Visibility",
  backlinks: "Backlinks",
  coverage: "Coverage",
  mentions: "Mentions",
  snippets: "Snippets",
  tasks: "Tasks",
  content_gaps: "Content Gaps",
  local: "Local Grid",
};

/**
 * Download buttons that hit the authenticated /api/export endpoint.
 * Each dataset offers both CSV (spreadsheets) and JSON (BigQuery/Looker/API).
 */
export function ExportButtons({
  projectId,
  types,
  formats = ["csv", "json"],
}: {
  projectId: string;
  types: ExportType[];
  formats?: Array<"csv" | "json">;
}) {
  const url = (t: ExportType, f: string) =>
    `/api/export?projectId=${encodeURIComponent(projectId)}&type=${t}&format=${f}`;

  return (
    <div className="flex flex-wrap gap-2">
      {types.map((t) => (
        <div key={t} className="inline-flex items-center overflow-hidden rounded-lg border border-border text-xs font-medium">
          <span className="px-2.5 py-1.5 text-muted-foreground">{LABELS[t]}</span>
          {formats.map((f) => (
            <a
              key={f}
              href={url(t, f)}
              className="border-l border-border px-2.5 py-1.5 hover:bg-secondary"
              title={`Download ${LABELS[t]} as ${f.toUpperCase()}`}
            >
              {f.toUpperCase()}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}
