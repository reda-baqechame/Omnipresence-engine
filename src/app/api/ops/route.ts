import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { OpsCreateSchema, OpsPatchSchema } from "@/lib/validation/schemas";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { inngest } from "@/lib/inngest/client";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id);

  const orgIds = (memberships || []).map((m) => m.organization_id);
  if (!orgIds.length) return NextResponse.json({ items: [] });

  const { data: items } = await supabase
    .from("ops_queue")
    .select("*, projects(name, domain)")
    .in("organization_id", orgIds)
    .in("status", ["pending", "approved", "executing"])
    .order("sla_due_at", { ascending: true })
    .limit(100);

  return NextResponse.json({ items: items || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, OpsCreateSchema);
  if (parsed.response) return parsed.response;
  const { projectId, organizationId, actionType, title, payload, riskLevel, taskId } = parsed.data;

  // Verify the caller can act on this project AND that the project actually
  // belongs to the supplied organization (prevents cross-org queue injection).
  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access || access.organizationId !== organizationId) return apiForbidden();

  const slaDue = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("ops_queue")
    .insert({
      project_id: projectId,
      organization_id: organizationId,
      action_type: actionType,
      title,
      payload: payload || {},
      task_id: taskId || null,
      risk_level: riskLevel || "low",
      status: riskLevel === "high" ? "pending" : "approved",
      sla_due_at: slaDue,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, OpsPatchSchema);
  if (parsed.response) return parsed.response;
  const { id, status, assignedTo, execute } = parsed.data;

  // Verify the caller owns the queue item's project before mutating/executing it.
  const { data: existing } = await supabase
    .from("ops_queue")
    .select("id, project_id")
    .eq("id", id)
    .single();
  if (!existing) return apiError("Ops item not found", 404);
  const access = await verifyProjectAccess(supabase, existing.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (assignedTo) updates.assigned_to = assignedTo;

  // Execute = hand the item to the Inngest worker, which runs the REAL action
  // (CMS/schema/IndexNow/GBP/social) off the request path and writes back the
  // result + ledger entry. No more fake "completed" without doing the work.
  if (execute) {
    updates.status = "executing";
  }

  const { data: item } = await supabase
    .from("ops_queue")
    .update(updates)
    .eq("id", id)
    .select("*, projects(id, name)")
    .single();

  if (execute && item) {
    try {
      await inngest.send({
        name: "ops/execute.requested",
        data: { opsId: id, projectId: item.project_id },
      });
    } catch {
      await supabase.from("ops_queue").update({ status: "approved" }).eq("id", id);
      return apiError("Failed to queue execution", 502);
    }
  }

  return NextResponse.json({ item, queued: Boolean(execute) });
}
