import type { SupabaseClient } from "@supabase/supabase-js";
import {
  researchKeywordsLive,
  keywordDifficultyLive,
  contentGapsLive,
  backlinkGapsLive,
  keywordOpportunitiesLive,
  hasIntelligenceApi,
  type KeywordResearchOptions,
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
import { loadProjectIntegration } from "@/lib/integrations/store";
import { recordMeasurementEvidence } from "@/lib/engines/evidence";

interface GoogleAdsIntegration extends Record<string, unknown> {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerId?: string;
  loginCustomerId?: string;
}

/**
 * Resolve per-tenant Keyword Planner options for a project: loads the project's
 * connected Google Ads OAuth (if any) so its own account/quota powers real
 * volume/CPC, plus an optional geo. When no integration is connected the planner
 * falls back to process-wide env (if set) or the clearly-labeled heuristic.
 */
export async function loadPlannerOptions(
  supabase: SupabaseClient,
  projectId: string,
  geo?: string
): Promise<KeywordResearchOptions | undefined> {
  const creds = await loadProjectIntegration<GoogleAdsIntegration>(supabase, projectId, "google_ads");
  if (!creds && !geo) return undefined;
  return {
    geo,
    credentials: creds
      ? {
          developerToken: creds.developerToken,
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          refreshToken: creds.refreshToken,
          customerId: creds.customerId,
          loginCustomerId: creds.loginCustomerId,
        }
      : undefined,
  };
}

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
  anchor?: VolumeAnchor | null,
  maxKeywords = 20,
  plannerOptions?: KeywordResearchOptions
): Promise<{ opportunities: KeywordOpportunityRow[]; live: boolean }> {
  if (!preferLiveData() || !hasIntelligenceApi()) {
    return { opportunities: [], live: false };
  }

  const research = await researchKeywordsLive(seed, plannerOptions);
  if (!research) return { opportunities: [], live: false };

  const allKeywords = [
    ...research.suggestions.map((s) => s.keyword),
    ...research.related.map((r) => r.keyword),
  ].slice(0, Math.max(1, maxKeywords));

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

  // When no SERP-based difficulty resolved, we fall back to a flat heuristic. Those
  // rows must NOT be stamped with a measured-sounding source ("omnidata_serp") —
  // they are heuristics and are labeled as such so the UI never shows a fabricated
  // KD/opportunity as if it were SERP-derived.
  const usingHeuristicFallback = scored.length === 0;
  const baseRows = usingHeuristicFallback
    ? allKeywords.map((k) => ({
        keyword: k,
        difficulty: 50,
        difficulty_method: "heuristic" as const,
        intent: "informational",
        our_position: null,
        opportunity_score: 40,
      }))
    : scored;
  const opportunities: KeywordOpportunityRow[] = baseRows.map((row) => ({
    keyword: row.keyword,
    volume_estimate: volumeMap.get(row.keyword),
    trend_index: trendMap.get(row.keyword),
    difficulty: row.difficulty,
    difficulty_method: row.difficulty_method,
    intent: row.intent,
    our_position: row.our_position,
    opportunity_score: row.opportunity_score,
    source: usingHeuristicFallback
      ? "heuristic"
      : research.data_source === "keyword_planner"
        ? "keyword_planner"
        : "omnidata_serp",
  }));

  await applyVolumeCalibration(opportunities, research.data_source, anchor);

  return { opportunities: opportunities.sort((a, b) => b.opportunity_score - a.opportunity_score), live: true };
}

/**
 * Bulk keyword research across many seeds (Phase 9). Processes seeds
 * sequentially (keyless sources are rate-sensitive), deduping keywords across
 * seeds so 1k+ keyword universes can be built from a handful of seeds. The
 * optional onProgress callback lets a job row report incremental progress.
 */
export async function runBulkKeywordResearch(
  seeds: string[],
  domain?: string,
  anchor?: VolumeAnchor | null,
  options?: {
    maxPerSeed?: number;
    onProgress?: (processed: number, found: number) => Promise<void> | void;
    plannerOptions?: KeywordResearchOptions;
  }
): Promise<{ opportunities: KeywordOpportunityRow[]; live: boolean; processed: number }> {
  const maxPerSeed = options?.maxPerSeed ?? 50;
  const cleaned = Array.from(
    new Set(seeds.map((s) => s.trim().toLowerCase()).filter(Boolean))
  ).slice(0, 100);

  const byKeyword = new Map<string, KeywordOpportunityRow>();
  let anyLive = false;
  let processed = 0;

  for (const seed of cleaned) {
    const { opportunities, live } = await runKeywordResearch(seed, domain, anchor, maxPerSeed, options?.plannerOptions);
    if (live) anyLive = true;
    for (const o of opportunities) {
      const key = o.keyword.trim().toLowerCase();
      const existing = byKeyword.get(key);
      // Keep the higher-opportunity / higher-confidence variant on collisions.
      if (!existing || o.opportunity_score > existing.opportunity_score) {
        byKeyword.set(key, o);
      }
    }
    processed += 1;
    await options?.onProgress?.(processed, byKeyword.size);
  }

  const opportunities = Array.from(byKeyword.values()).sort(
    (a, b) => b.opportunity_score - a.opportunity_score
  );
  return { opportunities, live: anyLive, processed };
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
  const confidenceFor = (c?: VolumeConfidence): number =>
    c === "high" ? 0.9 : c === "medium" ? 0.6 : 0.3;
  const { error } = await supabase.from("keyword_opportunities").upsert(
    rows.map((r) => ({
      project_id: projectId,
      keyword: r.keyword,
      volume_estimate: r.volume_estimate,
      volume_range: r.volume_range,
      volume_low: r.volume_low,
      volume_high: r.volume_high,
      volume_confidence: r.volume_confidence,
      trend_index: r.trend_index,
      difficulty: r.difficulty,
      difficulty_method: r.difficulty_method,
      intent: r.intent,
      our_position: r.our_position,
      opportunity_score: r.opportunity_score,
      source: r.source,
      status: "identified",
      // Volume is exact only from Keyword Planner; everything else is an honest estimate.
      data_source: r.volume_confidence === "high" ? "measured" : "estimated",
      confidence: confidenceFor(r.volume_confidence),
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "project_id,keyword" }
  );
  if (!error) {
    const bounded = rows.slice(0, 25);
    await Promise.all(
      bounded.map((r) =>
        recordMeasurementEvidence(supabase, {
          projectId,
          capability: "keyword",
          target: r.keyword,
          provider: r.source,
          dataSource: r.volume_confidence === "high" ? "measured" : "estimated",
          confidence: confidenceFor(r.volume_confidence),
          rawPayload: r,
          excerpt: {
            volume_range: r.volume_range,
            difficulty: r.difficulty,
            opportunity_score: r.opportunity_score,
          },
        })
      )
    );
  }
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
