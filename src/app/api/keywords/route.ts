import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  runKeywordResearch,
  persistKeywordOpportunities,
  analyzeContentGaps,
  analyzeBacklinkGaps,
  scoreSingleKeyword,
} from "@/lib/engines/keyword-intelligence";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

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

  const body = await request.json();
  const { projectId, seed, action, keyword } = body as {
    projectId: string;
    seed?: string;
    keyword?: string;
    action?: "research" | "content_gaps" | "backlink_gaps" | "difficulty";
  };

  if (!projectId) return apiError("projectId required");

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
  const { opportunities, live } = await runKeywordResearch(researchSeed, project.domain);
  const saved = await persistKeywordOpportunities(supabase, projectId, opportunities);

  return NextResponse.json({ opportunities, saved, live, seed: researchSeed });
}
