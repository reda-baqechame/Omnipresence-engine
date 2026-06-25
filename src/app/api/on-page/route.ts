import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDailyOnPageAutomation, syncOnPageQueueForProject } from "@/lib/engines/on-page-queue";
import { loadProjectIntegration, type CmsCredentials } from "@/lib/integrations/store";
import { patchWordPressPageMeta } from "@/lib/integrations/cms-patcher";
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
    .from("ops_queue")
    .select("*")
    .eq("project_id", projectId)
    .like("action_type", "on_page_%")
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ fixes: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, action } = await request.json() as { projectId: string; action?: string };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain, name")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  if (action === "sync_findings") {
    const n = await syncOnPageQueueForProject(supabase, projectId);
    return NextResponse.json({ synced: n });
  }

  const n = await runDailyOnPageAutomation(supabase, projectId, project.domain, project.name);
  return NextResponse.json({ proposed: n, live: true });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { queueId, apply } = await request.json() as { queueId: string; apply?: boolean };
  if (!queueId) return apiError("queueId required");

  const { data: item } = await supabase.from("ops_queue").select("*").eq("id", queueId).single();
  if (!item) return apiError("Not found", 404);

  const access = await verifyProjectAccess(supabase, item.project_id, user.id, "member");
  if (!access) return apiForbidden();

  await supabase.from("ops_queue").update({ status: "approved" }).eq("id", queueId);

  if (apply) {
    const creds = await loadProjectIntegration<CmsCredentials>(supabase, item.project_id, "wordpress");
    const payload = item.payload as { url?: string; field?: string; proposed?: string };
    if (creds && payload.url && payload.proposed) {
      const slug = new URL(payload.url).pathname.split("/").filter(Boolean).pop();
      if (payload.field === "title") {
        await patchWordPressPageMeta(creds, { slug, title: payload.proposed });
      } else if (payload.field === "meta_description") {
        await patchWordPressPageMeta(creds, { slug, metaDescription: payload.proposed });
      }
      await supabase.from("ops_queue").update({ status: "completed" }).eq("id", queueId);
    }
  }

  return NextResponse.json({ ok: true });
}
