import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  trackKeyword,
  runRankCheckForProject,
  runAllRankChecks,
  importKeywordsFromPrompts,
} from "@/lib/engines/rank-tracker-service";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: keywords } = await supabase
    .from("rank_keywords")
    .select("*")
    .eq("project_id", projectId)
    .order("last_checked_at", { ascending: false, nullsFirst: false });

  const keywordIds = (keywords || []).map((k) => k.id);
  let snapshots: unknown[] = [];
  if (keywordIds.length) {
    const { data } = await supabase
      .from("rank_snapshots")
      .select("*")
      .in("keyword_id", keywordIds)
      .order("checked_at", { ascending: false })
      .limit(400);
    snapshots = data || [];
  }

  const { data: alerts } = await supabase
    .from("rank_alerts")
    .select("*")
    .eq("project_id", projectId)
    .eq("acknowledged", false)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ keywords: keywords || [], snapshots, alerts: alerts || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, keyword, location, device, action, alertId } = body as {
    projectId: string;
    keyword?: string;
    location?: string;
    device?: "desktop" | "mobile";
    action?: "check_all" | "import_prompts" | "ack_alert";
    alertId?: string;
  };

  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  if (action === "ack_alert") {
    if (!alertId) return apiError("alertId required");
    await supabase.from("rank_alerts").update({ acknowledged: true }).eq("id", alertId).eq("project_id", projectId);
    return NextResponse.json({ ok: true });
  }

  if (action === "import_prompts") {
    const count = await importKeywordsFromPrompts(supabase, projectId);
    return NextResponse.json({ imported: count });
  }

  if (action === "check_all") {
    const results = await runAllRankChecks(supabase, projectId, project.domain);
    return NextResponse.json({ checked: results.length, results });
  }

  if (!keyword?.trim()) return apiError("keyword required");

  const dev = device === "mobile" ? "mobile" : "desktop";
  const tracked = await trackKeyword(supabase, projectId, keyword, location || "United States", dev);
  if (!tracked) return apiError("Failed to track keyword");

  const result = await runRankCheckForProject(
    supabase,
    projectId,
    project.domain,
    tracked.id,
    keyword,
    location || "United States",
    dev
  );

  return NextResponse.json({ result });
}
