import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdminAuthorized } from "@/lib/security/admin-auth";
import { apiUnauthorized } from "@/lib/security/api-response";
import { buildBenchmarkReadinessReport } from "@/lib/engines/benchmark-readiness";

export const runtime = "nodejs";

/**
 * GET /api/admin/benchmark-readiness
 * Configuration + evidence status only — never runs paid providers.
 */
export async function GET(request: NextRequest) {
  if (!(await isPlatformAdminAuthorized(request, "BENCHMARK_SECRET"))) {
    return apiUnauthorized();
  }

  const supabase = await createServiceClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 45);

  const { data: rows, error } = await supabase
    .from("benchmark_runs")
    .select("run_at")
    .gte("run_at", since.toISOString())
    .order("run_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = rows || [];
  const report = buildBenchmarkReadinessReport({
    latestRunAt: list[0]?.run_at ?? null,
    rowCountLookback: list.length,
    migrationsOk: true,
    missingTables: [],
  });

  return NextResponse.json(report);
}
