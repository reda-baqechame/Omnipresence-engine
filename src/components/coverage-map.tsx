"use client";

import type { CoverageItem } from "@/types/database";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { CapabilityEvidenceBar } from "@/components/capability-evidence-bar";

interface CoverageMapProps {
  items: CoverageItem[];
  projectId?: string;
}

export function CoverageMap({ items, projectId }: CoverageMapProps) {
  return (
    <div className="space-y-3">
      {projectId && (
        <CapabilityEvidenceBar
          projectId={projectId}
          capability="coverage"
          target=""
          label="Coverage proof"
          quality={items.length > 0 ? "measured" : "unavailable"}
        />
      )}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((item) => {
        const unverified = item.data_quality === "unavailable";
        const status = unverified ? "Unknown" : item.is_present ? "Present" : "Missing";
        return (
          <div
            key={item.id}
            className={`border rounded-lg p-3 text-sm ${
              item.is_present && !unverified
                ? "border-green-500/40 bg-green-500/5"
                : "border-border bg-card"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <p className="font-medium truncate">{item.platform_name}</p>
              <ProvenanceBadge quality={item.data_quality ?? item.data_source} confidence={item.confidence} />
            </div>
            <p
              className={
                unverified
                  ? "text-muted-foreground"
                  : item.is_present
                    ? "text-green-400"
                    : "text-muted-foreground"
              }
            >
              {status}
            </p>
            {item.competitor_present && (
              <p className="text-xs text-orange-400 mt-1">Competitor active</p>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
