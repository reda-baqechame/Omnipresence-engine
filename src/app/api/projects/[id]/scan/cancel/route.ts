import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";

/**
 * User-initiated stop for an in-progress visibility scan. Marks the active
 * visibility_runs row `cancelling`; the scan loop (runVisibilityScan) checks
 * this flag between prompt/engine iterations and stops before its next
 * provider call, finalizing the run to `cancelled` rather than `completed`.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const service = await createServiceClient();
  const { data: activeRun } = await service
    .from("visibility_runs")
    .select("id, status")
    .eq("project_id", id)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activeRun) return apiNotFound();

  const now = new Date().toISOString();
  const { data: updated, error } = await service
    .from("visibility_runs")
    .update({ status: "cancelling", cancel_requested_at: now })
    .eq("id", activeRun.id)
    .in("status", ["pending", "running"])
    .select("status")
    .single();

  if (error || !updated) {
    return NextResponse.json({ status: "not_cancelled" });
  }

  return NextResponse.json({ status: updated.status });
}
