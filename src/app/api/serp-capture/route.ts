import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { buildGscInsights } from "@/lib/engines/gsc-queries";
import {
  detectSnippetOpportunities,
  generateSnippetBlock,
  createDecayRefreshTasks,
  type SnippetFormat,
} from "@/lib/engines/serp-capture";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("snippet_opportunities")
    .select("keyword, feature, current_position, recommended_format, owned")
    .eq("project_id", projectId)
    .order("owned", { ascending: true })
    .limit(200);

  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action, keyword, format } = body as {
    projectId: string;
    action: "detect" | "snippet_block" | "decay_tasks";
    keyword?: string;
    format?: SnippetFormat;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);
  const brand = project.name || project.domain;

  if (action === "detect") {
    const { data: ranks } = await supabase
      .from("rank_keywords")
      .select("keyword, last_position, last_serp_features")
      .eq("project_id", projectId)
      .limit(1000);

    const opps = detectSnippetOpportunities(ranks || []);

    if (opps.length) {
      await supabase.from("snippet_opportunities").upsert(
        opps.map((o) => ({
          project_id: projectId,
          keyword: o.keyword,
          feature: o.feature,
          current_position: o.currentPosition,
          recommended_format: o.recommendedFormat,
          owned: false,
          last_checked_at: new Date().toISOString(),
        })),
        { onConflict: "project_id,keyword,feature" }
      );
    }

    return NextResponse.json({ found: opps.length, opportunities: opps });
  }

  if (action === "snippet_block") {
    if (!keyword) return apiError("keyword required");
    const result = await generateSnippetBlock({ keyword, format: format || "paragraph", brand });
    return NextResponse.json(result);
  }

  if (action === "decay_tasks") {
    const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
    if (!token) {
      return NextResponse.json({
        available: false,
        reason: "Connect Google Search Console to detect content decay from real data.",
      });
    }
    const insights = await buildGscInsights(token, project.domain);
    if (!insights.available || !project.organization_id) {
      return NextResponse.json({ available: false, reason: "No GSC data available." });
    }
    const { created } = await createDecayRefreshTasks(
      supabase,
      projectId,
      project.organization_id,
      insights.decay
    );
    return NextResponse.json({ available: true, decaying: insights.decay.length, tasksCreated: created, decay: insights.decay.slice(0, 30) });
  }

  return apiError("Unknown action");
}
