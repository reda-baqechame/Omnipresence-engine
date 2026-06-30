import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRankPosition } from "@/lib/providers/dataforseo";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { buildGscPositionMap, type GscPositionEntry } from "@/lib/engines/gsc-queries";
import { logProviderError } from "@/lib/observability/log";
import {
  ctrByPosition,
  shareOfVoiceFromPositions,
  isStrikingDistance,
  classifyRankChange,
} from "@/lib/engines/rank-math";

export type RankDevice = "desktop" | "mobile";

/** Where a tracked position came from — first-party (truth) vs public SERP. */
export type RankSource = "first_party" | "public_serp";

export interface CompetitorOverlayEntry {
  domain: string;
  position: number | null;
}

export interface RankCheckResult {
  keywordId: string;
  keyword: string;
  position: number | null;
  rankingUrl?: string;
  serpFeatures: string[];
  strikingDistance: boolean;
  cannibalizationUrls: Array<{ url: string; position: number }>;
  competitorOverlay: CompetitorOverlayEntry[];
  shareOfVoice: number | null;
  brandInAiOverview: boolean | null;
  device: RankDevice;
  checkedAt: string;
  /** Provenance: GSC first-party truth vs public SERP scrape. */
  source: RankSource;
  /** Public SERP position kept alongside first-party for cross-checking. */
  publicPosition: number | null;
  confidence: number;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

export async function trackKeyword(
  supabase: SupabaseClient,
  projectId: string,
  keyword: string,
  location = "United States",
  device: RankDevice = "desktop"
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("rank_keywords")
    .upsert(
      { project_id: projectId, keyword: keyword.trim(), location, device },
      { onConflict: "project_id,keyword,location,device" }
    )
    .select("id")
    .single();

  if (error) return null;
  return data;
}

async function loadResolvedCompetitorDomains(
  supabase: SupabaseClient,
  projectId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("competitors")
    .select("domain")
    .eq("project_id", projectId)
    .not("domain", "is", null);
  return Array.from(new Set((data || []).map((c) => hostnameOf(c.domain)).filter(Boolean)));
}

export async function runRankCheckForProject(
  supabase: SupabaseClient,
  projectId: string,
  domain: string,
  keywordId: string,
  keyword: string,
  location: string,
  device: RankDevice = "desktop",
  competitorDomains?: string[],
  firstPartyPositions?: Map<string, GscPositionEntry> | null
): Promise<RankCheckResult | null> {
  const competitors = competitorDomains ?? (await loadResolvedCompetitorDomains(supabase, projectId));
  const brandHost = hostnameOf(domain);
  const checkedAt = new Date().toISOString();

  // Read previous position first so we can detect drops regardless of path.
  const { data: prev } = await supabase
    .from("rank_keywords")
    .select("last_position")
    .eq("id", keywordId)
    .maybeSingle();
  const previousPosition = prev?.last_position ?? null;

  // Preferred path: full SERP via the provider router (Serper → Brave →
  // OmniData/DataForSEO) so rank tracking works on the cheap/keyless stack too,
  // not only when a paid backend is configured.
  const serp = await searchGoogleOrganicRouter(keyword, location, domain, competitors);

  let position: number | null = null;
  let rankingUrl: string | undefined;
  let serpFeatures: string[] = [];
  let cannibalizationUrls: Array<{ url: string; position: number }> = [];
  let competitorOverlay: CompetitorOverlayEntry[] = [];
  let shareOfVoice: number | null = null;
  let brandInAiOverview: boolean | null = null;

  if (serp.success && serp.data) {
    const organic = serp.data.organicResults || [];
    const ours = organic
      .filter((r) => hostnameOf(r.url) === brandHost)
      .sort((a, b) => a.position - b.position);
    position = ours[0]?.position ?? null;
    rankingUrl = ours[0]?.url;
    cannibalizationUrls = ours.length > 1 ? ours.map((r) => ({ url: r.url, position: r.position })) : [];

    competitorOverlay = competitors.map((c) => {
      const hit = organic
        .filter((r) => hostnameOf(r.url) === c)
        .sort((a, b) => a.position - b.position)[0];
      return { domain: c, position: hit?.position ?? null };
    });

    shareOfVoice = shareOfVoiceFromPositions(
      position,
      competitorOverlay.map((c) => c.position)
    );

    serpFeatures = serp.data.serpFeatures || [];
    brandInAiOverview = serp.data.aiOverview
      ? serp.data.aiOverview.citedDomains.includes(brandHost)
      : false;
  } else {
    // Fallback: minimal rank-only check (still honest about missing extras).
    const basic = await checkRankPosition(keyword, domain, location);
    if (!basic.success || !basic.data) return null;
    position = basic.data.position;
    rankingUrl = basic.data.url;
    serpFeatures = basic.data.serp_features;
  }

  // Public SERP is what we measured above. If Search Console first-party data
  // exists for this exact query, prefer it as the authoritative position — it is
  // the user's *actual* measured ranking (not a public scrape that can shift by
  // personalization/locale). We keep the public SERP position alongside it.
  const publicPosition = position;
  let source: RankSource = "public_serp";
  let provider = "serp";
  // Public SERP scrape is a real measurement, but it is a less authoritative
  // proxy for the user's true ranking than GSC, so it carries lower confidence.
  let confidence = 0.8;
  const fp = firstPartyPositions?.get(keyword.trim().toLowerCase());
  if (fp && fp.impressions > 0 && Number.isFinite(fp.position) && fp.position > 0) {
    position = Math.round(fp.position);
    source = "first_party";
    provider = "gsc";
    confidence = 0.99;
  }

  const strikingDistance = isStrikingDistance(position);

  await supabase.from("rank_snapshots").insert({
    keyword_id: keywordId,
    project_id: projectId,
    position,
    ranking_url: rankingUrl,
    serp_features: serpFeatures,
    device,
    cannibalization_urls: cannibalizationUrls,
    competitor_overlay: competitorOverlay,
    share_of_voice: shareOfVoice,
    brand_in_ai_overview: brandInAiOverview,
    checked_at: checkedAt,
    data_source: "measured",
    confidence,
    provider,
    is_estimated: false,
  });

  await supabase
    .from("rank_keywords")
    .update({
      last_position: position,
      last_checked_at: checkedAt,
      is_striking_distance: strikingDistance,
      target_url: rankingUrl,
      last_serp_features: serpFeatures,
      cannibalization_urls: cannibalizationUrls,
      competitor_overlay: competitorOverlay,
      share_of_voice: shareOfVoice,
      brand_in_ai_overview: brandInAiOverview,
      last_rank_source: source,
      last_confidence: confidence,
      last_public_position: publicPosition,
    })
    .eq("id", keywordId);

  // Rank-drop alert: fell off page 1, or dropped 5+ positions, or lost ranking.
  const rankChange = classifyRankChange(previousPosition, position);
  if (rankChange.isAlert) {
    await supabase.from("rank_alerts").insert({
      project_id: projectId,
      keyword_id: keywordId,
      keyword,
      alert_type: "rank_drop",
      previous_position: previousPosition,
      current_position: position,
      delta: rankChange.delta,
    });
  }

  return {
    keywordId,
    keyword,
    position,
    rankingUrl,
    serpFeatures,
    strikingDistance,
    cannibalizationUrls,
    competitorOverlay,
    shareOfVoice,
    brandInAiOverview,
    device,
    checkedAt,
    source,
    publicPosition,
    confidence,
  };
}

export async function runAllRankChecks(
  supabase: SupabaseClient,
  projectId: string,
  domain: string
): Promise<RankCheckResult[]> {
  const { data: keywords } = await supabase
    .from("rank_keywords")
    .select("id, keyword, location, device")
    .eq("project_id", projectId);

  if (!keywords?.length) return [];

  // Resolve competitor domains once for the whole batch.
  const competitors = await loadResolvedCompetitorDomains(supabase, projectId);

  // Build the Search Console first-party position map once per batch (when the
  // project has GSC connected). Best-effort: failures just fall back to SERP.
  const firstPartyPositions = await loadFirstPartyPositions(supabase, projectId, domain);

  const results: RankCheckResult[] = [];
  for (const kw of keywords) {
    const r = await runRankCheckForProject(
      supabase,
      projectId,
      domain,
      kw.id,
      kw.keyword,
      kw.location,
      (kw.device as RankDevice) || "desktop",
      competitors,
      firstPartyPositions
    );
    if (r) results.push(r);
  }
  return results;
}

/**
 * Load Search Console first-party positions for the project when GSC OAuth is
 * connected. Returns null (not an error) when unavailable so the rank tracker
 * cleanly falls back to public SERP.
 */
async function loadFirstPartyPositions(
  supabase: SupabaseClient,
  projectId: string,
  domain: string
): Promise<Map<string, GscPositionEntry> | null> {
  try {
    const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
    if (!token) return null;
    const map = await buildGscPositionMap(token, domain);
    return map.size > 0 ? map : null;
  } catch (error) {
    logProviderError("rank-tracker.firstParty", error, { projectId });
    return null;
  }
}

export async function importKeywordsFromPrompts(
  supabase: SupabaseClient,
  projectId: string,
  limit = 50
): Promise<number> {
  const { data: prompts } = await supabase
    .from("prompts")
    .select("text")
    .eq("project_id", projectId)
    .order("priority", { ascending: false })
    .limit(limit);

  if (!prompts?.length) return 0;

  let imported = 0;
  for (const p of prompts) {
    const row = await trackKeyword(supabase, projectId, p.text);
    if (row) imported++;
  }
  return imported;
}
