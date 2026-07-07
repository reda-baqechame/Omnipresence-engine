import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runDailyOnPageAutomation, syncOnPageQueueForProject } from "@/lib/engines/on-page-queue";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { OnPagePatchSchema, ProjectMutationSchema } from "@/lib/validation/schemas";
import { inngest } from "@/lib/inngest/client";

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

  const v = await validateBody(request, ProjectMutationSchema);
  if (v.response) return v.response;
  const { projectId, action } = v.data as { projectId: string; action?: string };

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

  const v = await validateBody(request, OnPagePatchSchema);
  if (v.response) return v.response;
  const { queueId, apply } = v.data;

  const { data: item } = await supabase.from("ops_queue").select("*").eq("id", queueId).single();
  if (!item) return apiError("Not found", 404);

  const access = await verifyProjectAccess(supabase, item.project_id, user.id, "member");
  if (!access) return apiForbidden();

  await supabase.from("ops_queue").update({ status: "approved" }).eq("id", queueId);

  if (apply) {
    await supabase.from("ops_queue").update({ status: "executing" }).eq("id", queueId);
    try {
      await inngest.send({
        name: "ops/execute.requested",
        data: { opsId: queueId, projectId: item.project_id },
      });
    } catch {
      await supabase.from("ops_queue").update({ status: "approved" }).eq("id", queueId);
      return apiError("Failed to queue execution", 502);
    }
  }

  return NextResponse.json({ ok: true, queued: Boolean(apply) });
}
