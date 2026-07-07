import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { ProjectMutationSchema } from "@/lib/validation/schemas";
import { buildTopicalMap, generateContentBrief } from "@/lib/engines/topical-authority";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("topical_maps")
    .select("hubs, hub_count, spoke_count, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ map: data || null });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, ProjectMutationSchema);
  if (v.response) return v.response;
  const { projectId, action, keyword } = v.data as {
    projectId: string;
    action: "build_map" | "brief";
    keyword?: string;
  };

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, industry, organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const brand = project.name || project.domain;

  if (action === "build_map") {
    const { data: kws } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .order("opportunity_score", { ascending: false })
      .limit(150);
    const keywords = (kws || []).map((k) => k.keyword as string).filter(Boolean);

    const result = await buildTopicalMap({
      brand,
      industry: project.industry || undefined,
      keywords,
      domain: project.domain,
    });
    if (result.available && result.map) {
      const spokeCount = result.map.hubs.reduce((s, h) => s + h.spokes.length, 0);
      await supabase.from("topical_maps").insert({
        project_id: projectId,
        hubs: result.map.hubs,
        hub_count: result.map.hubs.length,
        spoke_count: spokeCount,
      });
    }
    return NextResponse.json(result);
  }

  if (action === "brief") {
    if (!keyword) return apiError("keyword required for brief");

    // SERP winners to inform the brief.
    let serpWinners: string[] = [];
    try {
      const { searchGoogleOrganicRouter } = await import("@/lib/providers/serp-router");
      const serp = await searchGoogleOrganicRouter(keyword, "United States", project.domain, []);
      if (serp.success && serp.data) {
        serpWinners = serp.data.organicResults.slice(0, 10).map((r) => `${r.title} — ${r.url}`);
      }
    } catch {
      // brief still works without SERP context
    }

    const result = await generateContentBrief({ keyword, brand, serpWinners });

    // Content gap -> brief -> task loop: create a tracked execution task.
    if (result.available && result.brief && project.organization_id) {
      await supabase.from("execution_tasks").upsert(
        {
          project_id: projectId,
          organization_id: project.organization_id,
          title: `Write: ${result.brief.title}`,
          description: `Target keyword: ${keyword}. Intent: ${result.brief.search_intent}. ~${result.brief.word_count} words.`,
          source_module: "content_gap",
          source_id: `brief:${keyword}`,
          category: "content",
          priority: "medium",
          impact: 60,
          effort: 40,
          status: "todo",
          evidence: { brief: result.brief },
        },
        { onConflict: "project_id,source_module,source_id" }
      );
    }

    return NextResponse.json(result);
  }

  return apiError("Unknown action");
}
