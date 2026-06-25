"use client";

import type { ContentAsset } from "@/types/database";

const COLUMNS = [
  { id: "drafted", label: "Drafted" },
  { id: "approved", label: "Approved" },
  { id: "published", label: "Published" },
  { id: "indexed", label: "Indexed" },
  { id: "getting_traffic", label: "Traffic" },
  { id: "needs_refresh", label: "Refresh" },
] as const;

interface DistributionBoardProps {
  assets: Array<Pick<ContentAsset, "id" | "title" | "type" | "status" | "published_url">>;
}

export function DistributionBoard({ assets }: DistributionBoardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 overflow-x-auto">
      <h3 className="font-semibold mb-4">Distribution Board</h3>
      <div className="flex gap-3 min-w-max">
        {COLUMNS.map((col) => {
          const items = assets.filter((a) => a.status === col.id);
          return (
            <div key={col.id} className="w-52 shrink-0 bg-secondary/30 rounded-lg p-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {col.label} ({items.length})
              </p>
              <ul className="space-y-2">
                {items.map((a) => (
                  <li key={a.id} className="bg-card border border-border rounded p-2 text-xs">
                    <p className="font-medium truncate">{a.title}</p>
                    <p className="text-muted-foreground">{a.type}</p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
