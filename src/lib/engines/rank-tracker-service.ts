import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRankPosition } from "@/lib/providers/dataforseo";

export interface RankCheckResult {
  keywordId: string;
  keyword: string;
  position: number | null;
  rankingUrl?: string;
  serpFeatures: string[];
  strikingDistance: boolean;
  checkedAt: string;
}

export async function trackKeyword(
  supabase: SupabaseClient,
  projectId: string,
  keyword: string,
  location = "United States"
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("rank_keywords")
    .upsert(
      { project_id: projectId, keyword: keyword.trim(), location },
      { onConflict: "project_id,keyword,location" }
    )
    .select("id")
    .single();

  if (error) return null;
  return data;
}

export async function runRankCheckForProject(
  supabase: SupabaseClient,
  projectId: string,
  domain: string,
  keywordId: string,
  keyword: string,
  location: string
): Promise<RankCheckResult | null> {
  const result = await checkRankPosition(keyword, domain, location);
  if (!result.success || !result.data) return null;

  const checkedAt = new Date().toISOString();
  const { position, url, serp_features, striking_distance } = result.data;

  await supabase.from("rank_snapshots").insert({
    keyword_id: keywordId,
    project_id: projectId,
    position,
    ranking_url: url,
    serp_features,
    checked_at: checkedAt,
  });

  await supabase
    .from("rank_keywords")
    .update({
      last_position: position,
      last_checked_at: checkedAt,
      is_striking_distance: striking_distance,
      target_url: url,
    })
    .eq("id", keywordId);

  return {
    keywordId,
    keyword,
    position,
    rankingUrl: url,
    serpFeatures: serp_features,
    strikingDistance: striking_distance,
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
    .select("id, keyword, location")
    .eq("project_id", projectId);

  if (!keywords?.length) return [];

  const results: RankCheckResult[] = [];
  for (const kw of keywords) {
    const r = await runRankCheckForProject(
      supabase,
      projectId,
      domain,
      kw.id,
      kw.keyword,
      kw.location
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
