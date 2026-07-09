import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdminAuthorized } from "@/lib/security/admin-auth";
import { apiUnauthorized } from "@/lib/security/api-response";

export const runtime = "nodejs";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/**
 * Internal read-only feed for report_quality_violations (Patch F + Shot 2).
 * Service-role read with platform-admin gate — no customer exposure.
 */
export async function GET(request: NextRequest) {
  if (!(await isPlatformAdminAuthorized(request, "BENCHMARK_SECRET"))) {
    return apiUnauthorized();
  }

  const params = request.nextUrl.searchParams;
  const limitParam = Number(params.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const projectId = params.get("project_id")?.trim() || null;
  const reportId = params.get("report_id")?.trim() || null;
  const severity = params.get("severity")?.trim() || null;
  const allowedSeverities = new Set(["info", "warning", "error"]);
  if (severity && !allowedSeverities.has(severity)) {
    return NextResponse.json({ error: "Invalid severity filter" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  let query = supabase
    .from("report_quality_violations")
    .select(
      "id, report_id, project_id, org_id, report_type, claim_id, section, claim_type, field, reason, severity, source_label, classification, render_path, metadata, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (projectId) query = query.eq("project_id", projectId);
  if (reportId) query = query.eq("report_id", reportId);
  if (severity) query = query.eq("severity", severity);

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    count: count ?? (data?.length ?? 0),
    limit,
    generatedAt: new Date().toISOString(),
  });
}
