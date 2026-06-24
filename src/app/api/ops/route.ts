import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { recordLedgerAction } from "@/lib/engines/results-ledger";

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

  const { projectId, organizationId, actionType, title, payload, riskLevel } = await request.json();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership || !["owner", "admin", "member"].includes(membership.role)) {
    return apiForbidden();
  }

  const slaDue = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("ops_queue")
    .insert({
      project_id: projectId,
      organization_id: organizationId,
      action_type: actionType,
      title,
      payload: payload || {},
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

  const { id, status, assignedTo, execute } = await request.json();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) updates.status = status;
  if (assignedTo) updates.assigned_to = assignedTo;

  if (execute && status === "approved") {
    updates.status = "executing";
  }

  const { data: item } = await supabase
    .from("ops_queue")
    .update(updates)
    .eq("id", id)
    .select("*, projects(id, name)")
    .single();

  if (execute && item) {
    await recordLedgerAction(supabase, {
      project_id: item.project_id,
      action_type: item.action_type,
      description: `Ops executed: ${item.title}`,
      status: "completed",
      executed_by: user.id,
      outcome_snapshot: item.payload as Record<string, unknown>,
    });

    await supabase
      .from("ops_queue")
      .update({ status: "completed", executed_at: new Date().toISOString() })
      .eq("id", id);
  }

  return NextResponse.json({ item });
}
