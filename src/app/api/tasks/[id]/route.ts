import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import type { ExecutionTaskStatus, TaskPriority } from "@/types/database";

const VALID_STATUS: ExecutionTaskStatus[] = [
  "todo", "in_progress", "blocked", "done", "verified", "dismissed",
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("id, project_id")
    .eq("id", id)
    .single();
  if (!existing) return apiError("Task not found", 404);

  const access = await verifyProjectAccess(supabase, existing.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const body = await request.json();
  const { status, priority, owner, due_date, description } = body as {
    status?: ExecutionTaskStatus;
    priority?: TaskPriority;
    owner?: string | null;
    due_date?: string | null;
    description?: string;
  };

  const update: Record<string, unknown> = {};
  if (status) {
    if (!VALID_STATUS.includes(status)) return apiError("Invalid status");
    update.status = status;
    if (status === "done") update.completed_at = new Date().toISOString();
  }
  if (priority) update.priority = priority;
  if (owner !== undefined) update.owner = owner;
  if (due_date !== undefined) update.due_date = due_date;
  if (description !== undefined) update.description = description;

  if (Object.keys(update).length === 0) return apiError("No fields to update");

  const { data: task, error } = await supabase
    .from("execution_tasks")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return apiError(`Failed to update task: ${error.message}`, 500);
  return NextResponse.json({ task });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("id, project_id")
    .eq("id", id)
    .single();
  if (!existing) return apiError("Task not found", 404);

  const access = await verifyProjectAccess(supabase, existing.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const { error } = await supabase.from("execution_tasks").delete().eq("id", id);
  if (error) return apiError(`Failed to delete task: ${error.message}`, 500);
  return NextResponse.json({ ok: true });
}
