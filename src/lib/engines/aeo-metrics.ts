import type { VisibilityResult } from "@/types/database";
import { resultDataQuality, isCountableVisibility } from "@/lib/engines/provenance";

export interface AeoMetrics {
  shareOfVoice: number;
  citationRate: number;
  mentionRate: number;
  recommendationRate: number;
  competitorShare: Record<string, number>;
  engineBreakdown: Record<
    string,
    { mentions: number; citations: number; prompts: number }
  >;
  measuredRate: number;
  totalProbes: number;
}

export function calculateAeoMetrics(
  results: VisibilityResult[],
  brandName: string,
  competitors: string[]
): AeoMetrics {
  const measured = results.filter((r) => isCountableVisibility(resultDataQuality(r)));
  // Never blend demo rows into measured metrics. Use measured when present;
  // otherwise fall back to demo ONLY when the whole set is demo (preview mode).
  const demo = results.filter((r) => resultDataQuality(r) === "simulated");
  const pool = measured.length ? measured : demo.length === results.length ? demo : measured;

  let brandMentions = 0;
  let brandCitations = 0;
  let competitorMentions = 0;
  const competitorShare: Record<string, number> = {};
  const engineBreakdown: AeoMetrics["engineBreakdown"] = {};

  for (const r of pool) {
    if (!engineBreakdown[r.engine]) {
      engineBreakdown[r.engine] = { mentions: 0, citations: 0, prompts: 0 };
    }
    engineBreakdown[r.engine].prompts++;

    if (r.brand_mentioned) {
      brandMentions++;
      engineBreakdown[r.engine].mentions++;
    }
    if (r.brand_cited) {
      brandCitations++;
      engineBreakdown[r.engine].citations++;
    }

    const compMentions = r.competitor_mentions || {};
    for (const [comp, mentioned] of Object.entries(compMentions)) {
      if (!mentioned) continue;
      competitorMentions++;
      competitorShare[comp] = (competitorShare[comp] || 0) + 1;
    }
  }

  const total = pool.length || 1;
  const denom = brandMentions + competitorMentions || 1;

  return {
    shareOfVoice: brandMentions / denom,
    citationRate: brandMentions ? brandCitations / brandMentions : 0,
    mentionRate: brandMentions / total,
    recommendationRate: brandCitations / total,
    competitorShare,
    engineBreakdown,
    measuredRate: results.length ? measured.length / results.length : 0,
    totalProbes: total,
  };
}

export function compareAeoRuns(
  current: VisibilityResult[],
  previous: VisibilityResult[],
  brandName: string,
  competitors: string[]
): {
  current: AeoMetrics;
  previous: AeoMetrics;
  delta: {
    shareOfVoice: number;
    citationRate: number;
    mentionRate: number;
  };
} {
  const cur = calculateAeoMetrics(current, brandName, competitors);
  const prev = calculateAeoMetrics(previous, brandName, competitors);
  return {
    current: cur,
    previous: prev,
    delta: {
      shareOfVoice: cur.shareOfVoice - prev.shareOfVoice,
      citationRate: cur.citationRate - prev.citationRate,
      mentionRate: cur.mentionRate - prev.mentionRate,
    },
  };
}
