"use client";

import { calculateAdsEquivalent, type AdsEquivalentResult } from "@/lib/engines/ads-equivalent";
import { useState } from "react";
import { ProjectionBadge } from "@/components/projection-badge";

interface AdsEquivalentPanelProps {
  organicSessions?: number;
  aiReferralSessions?: number;
  industry?: string;
}

export function AdsEquivalentPanel({
  organicSessions = 0,
  aiReferralSessions = 0,
  industry,
}: AdsEquivalentPanelProps) {
  const [adSpend, setAdSpend] = useState(2000);
  const [result, setResult] = useState<AdsEquivalentResult | null>(null);

  function calculate() {
    setResult(
      calculateAdsEquivalent({
        organicSessions,
        aiReferralSessions,
        monthlyAdSpend: adSpend,
        industry,
      })
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold mb-2 flex items-center gap-2">
        Paid Ads Replacement Calculator
        <ProjectionBadge detail="Uses industry CPC benchmarks — not measured ad spend replacement." />
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        Estimates organic + AI referral value vs your monthly ad spend.
      </p>
      <div className="flex gap-2 items-end mb-3">
        <label className="text-sm">
          Monthly ad spend ($)
          <input
            type="number"
            value={adSpend}
            onChange={(e) => setAdSpend(Number(e.target.value))}
            className="block mt-1 bg-background border border-input rounded px-2 py-1 w-32"
          />
        </label>
        <button type="button" onClick={calculate} className="bg-primary text-primary-foreground px-3 py-2 rounded text-sm">
          Calculate
        </button>
      </div>
      {result && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground flex items-center gap-1">
            Organic value <ProjectionBadge />
          </dt>
          <dd>${result.organicValue.toLocaleString()}</dd>
          <dt className="text-muted-foreground flex items-center gap-1">
            AI referral value <ProjectionBadge />
          </dt>
          <dd>${result.aiValue.toLocaleString()}</dd>
          <dt className="text-muted-foreground flex items-center gap-1">
            Total organic equivalent <ProjectionBadge />
          </dt>
          <dd className="font-semibold">${result.totalOrganicValue.toLocaleString()}</dd>
          <dt className="text-muted-foreground flex items-center gap-1">
            Replacement ratio <ProjectionBadge />
          </dt>
          <dd>{Math.round(result.replacementRatio * 100)}%</dd>
        </dl>
      )}
    </div>
  );
}
