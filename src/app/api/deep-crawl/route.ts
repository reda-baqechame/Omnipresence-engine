import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { runDeepCrawl, persistDeepCrawl } from "@/lib/engines/deep-crawl";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const [{ data: issues }, { data: pages }] = await Promise.all([
    supabase.from("crawl_issues").select("type, severity, title, detail, urls, created_at").eq("project_id", projectId).order("severity"),
    supabase.from("crawl_pages").select("url, status, depth, title, word_count, redirect_hops, noindex").eq("project_id", projectId).order("depth").limit(500),
  ]);

  return NextResponse.json({ issues: issues || [], pages: pages || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let body: { projectId?: string; maxPages?: number };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }
  const { projectId } = body;
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain, organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const maxPages = Math.min(120, Math.max(10, Number(body.maxPages) || 60));
  const result = await runDeepCrawl(project.domain, maxPages);
  if (result.available) {
    await persistDeepCrawl(supabase, projectId, project.organization_id, result);
  }

  return NextResponse.json(result);
}
