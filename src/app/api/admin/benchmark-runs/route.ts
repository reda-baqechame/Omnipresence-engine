import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdminAuthorized } from "@/lib/security/admin-auth";
import { apiUnauthorized } from "@/lib/security/api-response";
import {
  summarizeBenchmarkRuns,
  type BenchmarkRunRecord,
} from "@/lib/engines/benchmark-dashboard";
import { describeProviders } from "@/lib/providers/router";
import {
  auditDataForSeoCategories,
  demotionReadinessReport,
} from "@/lib/engines/dataforseo-demotion-gate";

export const runtime = "nodejs";

/**
 * Read-only OmniData-vs-paid-provider parity dashboard feed (Patch H).
 * `benchmark_runs` carries no tenant/organization column — it is filled
 * exclusively by the nightly Inngest cron and the admin-triggered live
 * benchmark route, never by request-scoped user data — so this route reads
 * with the service client and gates access itself via isPlatformAdminAuthorized
 * (BENCHMARK_SECRET bearer, or any owner/admin org membership) rather than
 * relying on RLS, which intentionally has no per-tenant policy for this table
 * (see verify-rls-coverage.mjs POLICY_ALLOWLIST).
 */
export async function GET(request: NextRequest) {
  if (!(await isPlatformAdminAuthorized(request, "BENCHMARK_SECRET"))) {
    return apiUnauthorized();
  }

  const lookbackDaysParam = Number(request.nextUrl.searchParams.get("lookbackDays"));
  const lookbackDays = Number.isFinite(lookbackDaysParam) && lookbackDaysParam > 0
    ? Math.min(lookbackDaysParam, 90)
    : 45;
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("benchmark_runs")
    .select(
      "id, capability, metric_name, sovereign_provider, paid_provider, dataset_ref, sovereign_value, paid_value, delta, passed, threshold_note, run_at"
    )
    .gte("run_at", since)
    .order("run_at", { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data || []) as BenchmarkRunRecord[];
  const groups = summarizeBenchmarkRuns(rows);

  // Patch J: tie the real benchmark evidence above to the standing
  // fallback-only invariant on every paid DataForSEO adapter registered in
  // router.ts. `violations` should always be empty in a healthy deploy — a
  // non-empty array means router.ts was edited to promote DataForSEO without
  // the evidence this plan requires, and is surfaced here rather than only
  // failing a build-time script so it's visible in production too.
  const adapters = await describeProviders();
  const violations = auditDataForSeoCategories(adapters);
  const dataForSeoDemotion = demotionReadinessReport(adapters, groups);

  return NextResponse.json({
    lookbackDays,
    generatedAt: new Date().toISOString(),
    groups,
    rowCount: rows.length,
    dataForSeoDemotion,
    dataForSeoCategoryViolations: violations,
  });
}
