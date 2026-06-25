import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { analyzeInternalLinks } from "@/lib/engines/internal-linking";
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
    .from("internal_link_opportunities")
    .select("*")
    .eq("project_id", projectId)
    .order("relevance_score", { ascending: false });

  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, maxPages } = await request.json() as { projectId: string; maxPages?: number };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const { opportunities, pagesCrawled } = await analyzeInternalLinks(project.domain, maxPages ?? 40);

  const rows = opportunities.map((o) => ({
    project_id: projectId,
    source_url: o.sourceUrl,
    target_url: o.targetUrl,
    anchor_suggestion: o.anchorSuggestion,
    relevance_score: o.relevanceScore,
    context_snippet: o.contextSnippet,
    status: "identified",
  }));

  if (rows.length) {
    await supabase.from("internal_link_opportunities").upsert(rows, {
      onConflict: "project_id,source_url,target_url",
    });
  }

  return NextResponse.json({ pagesCrawled, found: opportunities.length, opportunities });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { id, status } = await request.json() as { id: string; status: string };
  if (!id || !status) return apiError("id and status required");

  const { data: row } = await supabase
    .from("internal_link_opportunities")
    .select("project_id")
    .eq("id", id)
    .single();
  if (!row) return apiError("Not found", 404);

  const access = await verifyProjectAccess(supabase, row.project_id, user.id, "member");
  if (!access) return apiForbidden();

  await supabase.from("internal_link_opportunities").update({ status }).eq("id", id);
  return NextResponse.json({ ok: true });
}
