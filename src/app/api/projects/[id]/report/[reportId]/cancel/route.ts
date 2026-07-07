import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";

/**
 * User-initiated stop for a report generation job. Marks the report
 * `cancelling` (or `cancelled` immediately if it hasn't started expensive
 * work yet); the generator loop is responsible for checking this flag between
 * steps and finalizing to `cancelled` before its next provider call. Never
 * flips a `ready`/`failed` report — cancellation only applies to in-flight work.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const service = await createServiceClient();
  const { data: report } = await service
    .from("reports")
    .select("id, project_id, status")
    .eq("id", reportId)
    .eq("project_id", id)
    .single();

  if (!report) return apiNotFound();

  if (report.status !== "pending" && report.status !== "generating") {
    // Idempotent no-op: already terminal (ready/failed/cancelled) or already cancelling.
    return NextResponse.json({ status: report.status });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await service
    .from("reports")
    .update({ status: "cancelling", cancel_requested_at: now })
    .eq("id", reportId)
    .in("status", ["pending", "generating"])
    .select("status")
    .single();

  if (error || !updated) {
    // Lost the race against completion — report finished between our read and write.
    return NextResponse.json({ status: "not_cancelled" });
  }

  return NextResponse.json({ status: updated.status });
}
