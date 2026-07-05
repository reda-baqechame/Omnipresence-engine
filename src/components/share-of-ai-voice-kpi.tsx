"use client";

import type { ReactNode } from "react";
import type { ShareOfVoiceResult } from "@/lib/engines/share-of-voice";
import { MetricGlossary } from "@/components/metric-glossary";

export function ShareOfAiVoiceKpi({
  sov,
  methodology = "Prominence-weighted Share of AI Voice: each mention is weighted by recommendation strength and answer position. Computed from grounded probes only — same headline KPI as Otterly.",
}: {
  sov: ShareOfVoiceResult;
  methodology?: string;
}) {
  const brandSov = sov.brand?.shareOfVoice ?? 0;
  const rank = sov.brandRank;

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Share of AI Voice</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Headline metric — weighted by citation prominence</p>
          <div className="text-4xl font-bold text-primary mt-1">
            {sov.sampleSize > 0 ? `${Math.round(brandSov * 100)}%` : "—"}
          </div>
          {rank != null && (
            <p className="text-xs text-muted-foreground mt-1">
              Rank #{rank} of {sov.leaderboard.length} entities · {sov.sampleSize} grounded probes
            </p>
          )}
          {sov.sampleSize === 0 && (
            <p className="text-xs text-yellow-400 mt-1">Run a visibility scan to measure Share of AI Voice.</p>
          )}
        </div>
        <span
          className="text-[10px] text-muted-foreground max-w-[200px] text-right cursor-help"
          title={methodology}
        >
          Weighted SoV
        </span>
      </div>
      <MetricGlossary keys={["share_of_ai_voice"]} />
    </div>
  );
}
