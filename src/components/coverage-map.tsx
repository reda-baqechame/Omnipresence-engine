"use client";

import type { CoverageItem } from "@/types/database";

interface CoverageMapProps {
  items: CoverageItem[];
}

export function CoverageMap({ items }: CoverageMapProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.id}
          className={`border rounded-lg p-3 text-sm ${
            item.is_present ? "border-green-500/40 bg-green-500/5" : "border-border bg-card"
          }`}
        >
          <p className="font-medium">{item.platform_name}</p>
          <p className={item.is_present ? "text-green-400" : "text-muted-foreground"}>
            {item.is_present ? "Present" : "Missing"}
          </p>
          {item.competitor_present && (
            <p className="text-xs text-orange-400 mt-1">Competitor active</p>
          )}
        </div>
      ))}
    </div>
  );
}
