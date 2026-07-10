import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { TasksCreateSchema } from "@/lib/validation/schemas";
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

  const parsed = await validateBody(request, TasksCreateSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const {
    projectId,
    title,
    description,
    priority,
    source_module,
    source_id,
    category,
    impact,
    effort,
    evidence,
    before_metric,
  } = body;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const sourceModule = source_module || "manual";
  const sid = source_id || `manual:${Date.now()}`;

  if (sourceModule === "searchops_opportunity" && source_id) {
    const { data: existing } = await supabase
      .from("execution_tasks")
      .select("*")
      .eq("project_id", projectId)
      .eq("source_module", sourceModule)
      .eq("source_id", sid)
      .maybeSingle();
    if (existing) return NextResponse.json({ task: existing, created: false });
  }

  const { data: task, error } = await supabase
    .from("execution_tasks")
    .insert({
      project_id: projectId,
      organization_id: access.organizationId,
      title,
      description: description ?? null,
      source_module: sourceModule,
      source_id: sid,
      category: category ?? null,
      priority: (priority || "medium") as TaskPriority,
      impact: impact ?? 30,
      effort: effort ?? 1,
      status: "todo",
      evidence: evidence ?? null,
      before_metric: before_metric ?? null,
    })
    .select("*")
    .single();

  if (error) return apiError(`Failed to create task: ${error.message}`, 500);
  return NextResponse.json({ task, created: true });
}
