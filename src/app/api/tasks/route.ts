import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { syncExecutionTasks } from "@/lib/engines/execution-tasks";
import type { TaskPriority } from "@/types/database";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: tasks } = await supabase
    .from("execution_tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("status", { ascending: true })
    .order("impact", { ascending: false });

  return NextResponse.json({ tasks: tasks || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action, title, description, priority } = body as {
    projectId: string;
    action?: "sync";
    title?: string;
    description?: string;
    priority?: TaskPriority;
  };

  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (action === "sync") {
    const result = await syncExecutionTasks(supabase, projectId, access.organizationId);
    return NextResponse.json(result);
  }

  if (!title?.trim()) return apiError("title required");

  const { data: task, error } = await supabase
    .from("execution_tasks")
    .insert({
      project_id: projectId,
      organization_id: access.organizationId,
      title: title.trim(),
      description: description ?? null,
      source_module: "manual",
      source_id: `manual:${Date.now()}`,
      priority: priority || "medium",
      impact: 30,
      effort: 1,
      status: "todo",
    })
    .select("*")
    .single();

  if (error) return apiError(`Failed to create task: ${error.message}`, 500);
  return NextResponse.json({ task });
}
