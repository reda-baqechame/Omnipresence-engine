import type { SupabaseClient } from "@supabase/supabase-js";
import {
  researchKeywordsLive,
  keywordDifficultyLive,
  contentGapsLive,
  backlinkGapsLive,
  keywordOpportunitiesLive,
  hasIntelligenceApi,
} from "@/lib/providers/intelligence-api";
import { preferLiveData } from "@/lib/config/capabilities";
import {
  calibrateWithAnchor,
  fromKnownVolume,
  volumeBucket,
  type VolumeAnchor,
  type VolumeConfidence,
} from "@/lib/engines/keyword-volume";
import { scoreKeywordsKeyless, hasKeylessDifficulty } from "@/lib/engines/keyword-difficulty";

export interface KeywordOpportunityRow {
  keyword: string;
  volume_estimate?: number;
  /** Honest log-scale bucket, e.g. "1K–10K" or "n/a". */
  volume_range?: string;
  volume_low?: number;
  volume_high?: number;
  /** Confidence in the volume figure: high=Keyword Planner, medium=Trends-extrapolated, low=relative/heuristic. */
  volume_confidence?: VolumeConfidence;
  /** Relative Google Trends demand index (0-100), not absolute volume. */
  trend_index?: number;
  difficulty?: number;
  /** How difficulty was derived: ranking_authority=real (authority of ranking pages), heuristic=fallback. */
  difficulty_method?: "ranking_authority" | "heuristic";
  intent?: string;
  our_position?: number | null;
  opportunity_score: number;
  source: string;
}

export async function runKeywordResearch(
  seed: string,
  domain?: string,
  anchor?: VolumeAnchor | null
): Promise<{ opportunities: KeywordOpportunityRow[]; live: boolean }> {
  if (!preferLiveData() || !hasIntelligenceApi()) {
    return { opportunities: [], live: false };
  }

  const research = await researchKeywordsLive(seed);
  if (!research) return { opportunities: [], live: false };

  const allKeywords = [
    ...research.suggestions.map((s) => s.keyword),
    ...research.related.map((r) => r.keyword),
  ].slice(0, 20);

  let scored: Array<{
    keyword: string;
    difficulty: number;
    difficulty_method?: "ranking_authority" | "heuristic";
    intent: string;
    our_position: number | null;
    opportunity_score: number;
  }> = [];

  if (domain && allKeywords.length) {
    const raw = await keywordOpportunitiesLive(domain, allKeywords);
    if (raw) scored = raw as typeof scored;
  }

  // No OmniData/DataForSEO opportunity scoring? Compute REAL keyword difficulty
  // keylessly from the Tranco authority of the domains actually ranking (the
  // technique behind Ahrefs/Semrush KD), so app-only users still get real KD.
  if (scored.length === 0 && domain && allKeywords.length && hasKeylessDifficulty()) {
    const keyless = await scoreKeywordsKeyless(domain, allKeywords);
    if (keyless.length) {
      scored = keyless.map((k) => ({
        keyword: k.keyword,
        difficulty: k.difficulty,
        difficulty_method: k.difficulty_method,
        intent: k.intent,
        our_position: k.our_position,
        opportunity_score: k.opportunity_score,
      }));
    }
  }

  const volumeMap = new Map(
    [...research.suggestions, ...research.related].map((k) => [k.keyword, k.volume_estimate])
  );
  const trendMap = new Map(
    [...research.suggestions, ...research.related].map((k) => [k.keyword, k.trend_index])
  );

  const opportunities: KeywordOpportunityRow[] = (scored.length ? scored : allKeywords.map((k) => ({
    keyword: k,
    difficulty: 50,
    difficulty_method: "heuristic" as const,
    intent: "informational",
    our_position: null,
    opportunity_score: 40,
  }))).map((row) => ({
    keyword: row.keyword,
    volume_estimate: volumeMap.get(row.keyword),
    trend_index: trendMap.get(row.keyword),
    difficulty: row.difficulty,
    difficulty_method: row.difficulty_method,
    intent: row.intent,
    our_position: row.our_position,
    opportunity_score: row.opportunity_score,
    source: research.data_source === "keyword_planner" ? "keyword_planner" : "omnidata_serp",
  }));

  await applyVolumeCalibration(opportunities, research.data_source, anchor);

  return { opportunities: opportunities.sort((a, b) => b.opportunity_score - a.opportunity_score), live: true };
}

/**
 * Attach honest volume buckets + confidence. Keyword Planner volumes are real
 * (high); otherwise extrapolate from a GSC/known anchor via Trends (medium);
 * else fall back to a heuristic bucket from the estimate (low).
 */
async function applyVolumeCalibration(
  opportunities: KeywordOpportunityRow[],
  dataSource: string | undefined,
  anchor?: VolumeAnchor | null
): Promise<void> {
  if (opportunities.length === 0) return;
  const top = opportunities.slice(0, 20).map((o) => o.keyword);

  if (dataSource === "keyword_planner") {
    for (const o of opportunities) {
      if (typeof o.volume_estimate === "number" && o.volume_estimate > 0) {
        const v = fromKnownVolume(o.keyword, o.volume_estimate, "keyword_planner");
        o.volume_range = v.range_bucket;
        o.volume_low = v.volume_low;
        o.volume_high = v.volume_high;
        o.volume_confidence = "high";
      }
    }
    return;
  }

  if (anchor) {
    const calibrated = await calibrateWithAnchor(top, anchor);
    for (const o of opportunities) {
      const v = calibrated.get(o.keyword);
      if (!v) continue;
      o.volume_estimate = v.volume ?? o.volume_estimate;
      o.volume_range = v.range_bucket;
      o.volume_low = v.volume_low;
      o.volume_high = v.volume_high;
      o.volume_confidence = v.confidence;
      if (typeof v.trend_index === "number") o.trend_index = v.trend_index;
    }
    return;
  }

  // No anchor: present a low-confidence bucket from whatever estimate exists.
  for (const o of opportunities) {
    if (typeof o.volume_estimate === "number" && o.volume_estimate > 0) {
      o.volume_range = volumeBucket(o.volume_estimate);
      o.volume_confidence = "low";
    }
  }
}

export async function persistKeywordOpportunities(
  supabase: SupabaseClient,
  projectId: string,
  rows: KeywordOpportunityRow[]
): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await supabase.from("keyword_opportunities").upsert(
    rows.map((r) => ({
      project_id: projectId,
      keyword: r.keyword,
      volume_estimate: r.volume_estimate,
      difficulty: r.difficulty,
      intent: r.intent,
      our_position: r.our_position,
      opportunity_score: r.opportunity_score,
      source: r.source,
      status: "identified",
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "project_id,keyword" }
  );
  return error ? 0 : rows.length;
}

export async function analyzeContentGaps(
  domain: string,
  competitors: string[],
  seeds: string[]
) {
  if (!preferLiveData()) return { gaps: [], live: false };
  const gaps = await contentGapsLive(domain, competitors, seeds);
  if (gaps?.length) return { gaps, live: true };
  const { contentGapsFromSerp } = await import("@/lib/engines/serp-content-gaps");
  const serpGaps = await contentGapsFromSerp(domain, competitors, seeds);
  return { gaps: serpGaps, live: serpGaps.length > 0 };
}

export async function analyzeBacklinkGaps(domain: string, competitors: string[]) {
  if (!preferLiveData()) return { gaps: [], live: false };
  const gaps = await backlinkGapsLive(domain, competitors);
  return { gaps: gaps || [], live: Boolean(gaps) };
}

export async function scoreSingleKeyword(keyword: string) {
  return keywordDifficultyLive(keyword);
}
