"use client";

type ExportType = "ranks" | "keywords" | "findings" | "ledger";

const LABELS: Record<ExportType, string> = {
  ranks: "Ranks CSV",
  keywords: "Keywords CSV",
  findings: "Findings CSV",
  ledger: "Activity CSV",
};

/** Download buttons that hit the authenticated /api/export CSV endpoint. */
export function ExportButtons({ projectId, types }: { projectId: string; types: ExportType[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {types.map((t) => (
        <a
          key={t}
          href={`/api/export?projectId=${encodeURIComponent(projectId)}&type=${t}`}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          ↓ {LABELS[t]}
        </a>
      ))}
    </div>
  );
}
