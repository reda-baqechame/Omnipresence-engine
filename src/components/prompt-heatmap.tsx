"use client";

import type { PromptCategory } from "@/types/database";

interface HeatmapCell {
  category: PromptCategory;
  prompts: number;
  mentionRate: number;
  citationRate: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  best_of: "Best of",
  comparison: "Comparison",
  local: "Local",
  problem_aware: "Problem",
  solution_aware: "Solution",
  pricing: "Pricing",
  trust: "Trust",
  alternatives: "Alternatives",
  reviews: "Reviews",
  transactional: "Transactional",
};

function cellColor(rate: number): string {
  if (rate >= 0.5) return "bg-green-500/30 border-green-500/50";
  if (rate >= 0.25) return "bg-yellow-500/20 border-yellow-500/40";
  if (rate > 0) return "bg-orange-500/15 border-orange-500/30";
  return "bg-secondary border-border";
}

export function PromptHeatmap({ cells }: { cells: HeatmapCell[] }) {
  if (cells.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        Import prompts and run a visibility scan to see ownership heatmap.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="font-semibold mb-2">Prompt Ownership Heatmap</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Mention and citation rates by funnel category (darker green = stronger ownership).
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cells.map((cell) => (
          <div
            key={cell.category}
            className={`rounded-xl border p-3 text-center ${cellColor(cell.mentionRate)}`}
          >
            <div className="text-xs font-medium mb-1">
              {CATEGORY_LABELS[cell.category] || cell.category}
            </div>
            <div className="text-lg font-bold">{Math.round(cell.mentionRate * 100)}%</div>
            <div className="text-xs text-muted-foreground">mention</div>
            <div className="text-sm mt-1">{Math.round(cell.citationRate * 100)}% cite</div>
            <div className="text-xs text-muted-foreground mt-1">{cell.prompts} prompts</div>
          </div>
        ))}
      </div>
    </div>
  );
}
