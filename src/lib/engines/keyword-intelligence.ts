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

export interface KeywordOpportunityRow {
  keyword: string;
  volume_estimate?: number;
  difficulty?: number;
  intent?: string;
  our_position?: number | null;
  opportunity_score: number;
  source: string;
}

export async function runKeywordResearch(
  seed: string,
  domain?: string
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
    intent: string;
    our_position: number | null;
    opportunity_score: number;
  }> = [];

  if (domain && allKeywords.length) {
    const raw = await keywordOpportunitiesLive(domain, allKeywords);
    if (raw) scored = raw as typeof scored;
  }

  const volumeMap = new Map(
    [...research.suggestions, ...research.related].map((k) => [
      (k as { keyword: string }).keyword,
      (k as { volume_estimate?: number }).volume_estimate,
    ])
  );

  const opportunities: KeywordOpportunityRow[] = (scored.length ? scored : allKeywords.map((k) => ({
    keyword: k,
    difficulty: 50,
    intent: "informational",
    our_position: null,
    opportunity_score: 40,
  }))).map((row) => ({
    keyword: row.keyword,
    volume_estimate: volumeMap.get(row.keyword),
    difficulty: row.difficulty,
    intent: row.intent,
    our_position: row.our_position,
    opportunity_score: row.opportunity_score,
    source: "omnidata_serp",
  }));

  return { opportunities: opportunities.sort((a, b) => b.opportunity_score - a.opportunity_score), live: true };
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
  return { gaps: gaps || [], live: Boolean(gaps) };
}

export async function analyzeBacklinkGaps(domain: string, competitors: string[]) {
  if (!preferLiveData()) return { gaps: [], live: false };
  const gaps = await backlinkGapsLive(domain, competitors);
  return { gaps: gaps || [], live: Boolean(gaps) };
}

export async function scoreSingleKeyword(keyword: string) {
  return keywordDifficultyLive(keyword);
}
