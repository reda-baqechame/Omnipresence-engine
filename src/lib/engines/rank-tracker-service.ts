import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRankPosition, searchGoogleOrganic } from "@/lib/providers/dataforseo";

export type RankDevice = "desktop" | "mobile";

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
}

/** Approximate organic CTR by position — used for share-of-voice weighting. */
function ctrByPosition(position: number | null): number {
  if (position == null) return 0;
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  if (position <= 20) return 0.008;
  return 0;
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
  competitorDomains?: string[]
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

  // Preferred path: full SERP so we can compute overlay/SoV/cannibalization/AIO.
  const serp = await searchGoogleOrganic(keyword, location, domain, competitors, device);

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

    const ourCtr = ctrByPosition(position);
    const compCtr = competitorOverlay.reduce((s, c) => s + ctrByPosition(c.position), 0);
    shareOfVoice = ourCtr + compCtr > 0 ? Math.round((ourCtr / (ourCtr + compCtr)) * 1000) / 1000 : 0;

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

  const strikingDistance = position != null && position > 3 && position <= 20;

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
    })
    .eq("id", keywordId);

  // Rank-drop alert: fell off page 1, or dropped 5+ positions, or lost ranking.
  const droppedOffPage1 = previousPosition != null && previousPosition <= 10 && (position == null || position > 10);
  const bigDrop = previousPosition != null && position != null && position - previousPosition >= 5;
  const lostRanking = previousPosition != null && position == null;
  if (droppedOffPage1 || bigDrop || lostRanking) {
    await supabase.from("rank_alerts").insert({
      project_id: projectId,
      keyword_id: keywordId,
      keyword,
      alert_type: "rank_drop",
      previous_position: previousPosition,
      current_position: position,
      delta: position != null && previousPosition != null ? position - previousPosition : null,
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
      competitors
    );
    if (r) results.push(r);
  }
  return results;
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
