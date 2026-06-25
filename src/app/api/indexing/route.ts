import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bulkSubmitUrls, parseUrlCsv } from "@/lib/engines/bulk-indexing";
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
    .from("url_indexing_log")
    .select("*")
    .eq("project_id", projectId)
    .order("submitted_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ submissions: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, urls, urlsCsv, engines } = await request.json() as {
    projectId: string;
    urls?: string[];
    urlsCsv?: string;
    engines?: Array<"indexnow" | "bing">;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase.from("projects").select("domain").eq("id", projectId).single();
  if (!project) return apiError("Project not found", 404);

  const list = urls?.length ? urls : urlsCsv ? parseUrlCsv(urlsCsv) : [];
  if (!list.length) return apiError("urls or urlsCsv required");

  const host = project.domain.replace(/^https?:\/\//, "").split("/")[0];
  const results = await bulkSubmitUrls(list, host, engines);

  if (results.length) {
    await supabase.from("url_indexing_log").insert(
      results.map((r) => ({
        project_id: projectId,
        url: r.url,
        engine: r.engine,
        status: r.status,
        submitted_at: r.submitted_at,
      }))
    );
  }

  return NextResponse.json({
    submitted: results.filter((r) => r.status === "submitted").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
