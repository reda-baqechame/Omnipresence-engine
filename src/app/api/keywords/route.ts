import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  runKeywordResearch,
  runBulkKeywordResearch,
  persistKeywordOpportunities,
  analyzeContentGaps,
  analyzeBacklinkGaps,
  scoreSingleKeyword,
  loadPlannerOptions,
} from "@/lib/engines/keyword-intelligence";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { KeywordsSchema } from "@/lib/validation/schemas";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { fetchGscTopQueries } from "@/lib/engines/gsc-queries";
import { deriveGscAnchor, type VolumeAnchor } from "@/lib/engines/keyword-volume";
import { buildKeywordUniverse } from "@/lib/engines/keyword-universe";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("keyword_opportunities")
    .select("*")
    .eq("project_id", projectId)
    .order("opportunity_score", { ascending: false })
    .limit(100);

  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, KeywordsSchema);
  if (parsed.response) return parsed.response;
  const { projectId, seed, seeds, action, keyword, geo, depth } = parsed.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain, industry, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const competitors = (project.competitors || []) as string[];

  if (action === "difficulty" && keyword) {
    const result = await scoreSingleKeyword(keyword);
    return NextResponse.json({ result, live: Boolean(result) });
  }

  if (action === "universe") {
    const universeSeed = (seed || project.industry || project.domain.replace(/^www\./, "").split(".")[0]).trim();
    const universe = await buildKeywordUniverse({ seed: universeSeed, depth });
    return NextResponse.json(universe);
  }

  if (action === "bulk_research") {
    const seedList = (seeds && seeds.length ? seeds : [seed].filter(Boolean) as string[])
      .map((s) => s.trim())
      .filter(Boolean);
    if (!seedList.length) return apiError("seeds required for bulk_research");

    const { data: job } = await supabase
      .from("keyword_jobs")
      .insert({
        project_id: projectId,
        seeds: seedList,
        status: "running",
        total_seeds: seedList.length,
      })
      .select("id")
      .single();

    try {
      const anchor = await deriveVolumeAnchorFromGsc(supabase, projectId, project.domain);
      const plannerOptions = await loadPlannerOptions(supabase, projectId, geo);
      const { opportunities, live, processed } = await runBulkKeywordResearch(
        seedList,
        project.domain,
        anchor,
        {
          plannerOptions,
          onProgress: async (p, found) => {
            if (job?.id) {
              await supabase
                .from("keyword_jobs")
                .update({ processed_seeds: p, keywords_found: found })
                .eq("id", job.id);
            }
          },
        }
      );
      const saved = await persistKeywordOpportunities(supabase, projectId, opportunities);
      if (job?.id) {
        await supabase
          .from("keyword_jobs")
          .update({
            status: "completed",
            processed_seeds: processed,
            keywords_found: opportunities.length,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      }
      return NextResponse.json({
        jobId: job?.id || null,
        opportunities,
        saved,
        live,
        processed,
        count: opportunities.length,
      });
    } catch (err) {
      if (job?.id) {
        await supabase
          .from("keyword_jobs")
          .update({ status: "failed", error: String(err), completed_at: new Date().toISOString() })
          .eq("id", job.id);
      }
      return apiError("Bulk keyword research failed", 500);
    }
  }

  if (action === "content_gaps") {
    const { data: prompts } = await supabase
      .from("prompts")
      .select("text")
      .eq("project_id", projectId)
      .limit(20);
    const seeds = [
      project.industry || project.domain.split(".")[0],
      ...(prompts || []).map((p) => p.text).slice(0, 10),
    ];
    const { gaps, live } = await analyzeContentGaps(project.domain, competitors, seeds);

    if (gaps.length) {
      await supabase.from("content_gap_findings").upsert(
        (gaps as Array<{
          keyword: string;
          competitor_domain: string;
          competitor_position: number;
          our_position: number | null;
          opportunity_score: number;
        }>).map((g) => ({
          project_id: projectId,
          keyword: g.keyword,
          competitor_domain: g.competitor_domain,
          competitor_position: g.competitor_position,
          our_position: g.our_position,
          opportunity_score: g.opportunity_score,
        })),
        { onConflict: "project_id,keyword,competitor_domain" }
      );
    }

    return NextResponse.json({ gaps, live, count: gaps.length });
  }

  if (action === "backlink_gaps") {
    const { gaps, live } = await analyzeBacklinkGaps(project.domain, competitors);
    return NextResponse.json({ gaps, live, count: gaps.length });
  }

  const researchSeed =
    seed || project.industry || project.domain.replace(/^www\./, "").split(".")[0];

  // Build a real volume anchor from Google Search Console when connected: a
  // query the site ranks top-10 for, where impressions ≈ monthly searches.
  // Lets us extrapolate absolute volume for other keywords via Google Trends.
  const anchor = await deriveVolumeAnchorFromGsc(supabase, projectId, project.domain);
  const plannerOptions = await loadPlannerOptions(supabase, projectId, geo);

  const { opportunities, live } = await runKeywordResearch(researchSeed, project.domain, anchor, 20, plannerOptions);
  const saved = await persistKeywordOpportunities(supabase, projectId, opportunities);

  return NextResponse.json({
    opportunities,
    saved,
    live,
    seed: researchSeed,
    volume_anchor: anchor ? { keyword: anchor.keyword, volume: anchor.volume } : null,
  });
}

async function deriveVolumeAnchorFromGsc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  domain: string
): Promise<VolumeAnchor | null> {
  try {
    const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
    if (!token) return null;
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const rows = await fetchGscTopQueries(token, domain, fmt(start), fmt(end), 200);
    return deriveGscAnchor(rows);
  } catch {
    return null;
  }
}
