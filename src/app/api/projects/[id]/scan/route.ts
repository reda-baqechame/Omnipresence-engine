import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import { verifyProjectAccess } from "@/lib/security/project-access";
import {
  ApiCreditExceededError,
  TenantBudgetExceededError,
  assertTenantSurfaceBudget,
} from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized } from "@/lib/security/api-response";
import { guardOrgEndpoint } from "@/lib/security/api-v1-guard";

const DEFAULT_STALE_SCAN_MS = 6 * 60 * 1000;
/** Visibility run with zero persisted results after this long is treated as wedged. */
const DEFAULT_STALE_VISIBILITY_RUN_MS = 25 * 60 * 1000;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const limited = await guardOrgEndpoint(access.organizationId, "project-scan", 12, 60 * 60 * 1000);
  if (limited) return limited;

  const serviceClient = await createServiceClient();

  // Per-tenant surface-measurement spend firewall: one noisy tenant must not be
  // able to burn the platform's shared paid-API budget for everyone. Disabled by
  // default (TENANT_DAILY_CREDIT_CAP=0); when on, return 429 cleanly.
  try {
    await assertTenantSurfaceBudget(serviceClient, access.organizationId, 10);
  } catch (error) {
    if (error instanceof TenantBudgetExceededError) {
      return apiError("Daily measurement budget reached for your account. Resets at 00:00 UTC.", 429);
    }
  }

  const email = await getOwnerEmail(serviceClient, access.organizationId);

  try {
    const result = await runProjectScan(serviceClient, id, { notifyEmail: email });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiCreditExceededError) {
      return apiError("API credit limit exceeded. Upgrade your plan or wait for reset.", 402);
    }
    await serviceClient.from("projects").update({ status: "draft" }).eq("id", id);
    return apiServerError("scan failed", error);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "viewer");
  if (!access) return apiNotFound();

  const { data: project } = await supabase
    .from("projects")
    .select("status, last_scan_at, updated_at")
    .eq("id", id)
    .single();
  if (!project) return apiNotFound();

  let status = project.status;
  let recovered = false;
  let message: string | null = null;

  if (project.status === "scanning") {
    const staleScanMs = Number(process.env.SCAN_STALE_MS ?? DEFAULT_STALE_SCAN_MS);
    const staleVisibilityRunMs = Number(
      process.env.SCAN_STALE_VISIBILITY_RUN_MS ?? DEFAULT_STALE_VISIBILITY_RUN_MS
    );
    const updatedAt = project.updated_at ? new Date(project.updated_at).getTime() : 0;
    const isStale = updatedAt > 0 && Date.now() - updatedAt > staleScanMs;

    const { data: activeRun } = await supabase
      .from("visibility_runs")
      .select("id, status, started_at")
      .eq("project_id", id)
      .in("status", ["pending", "running"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const runStartedAt = activeRun?.started_at ? new Date(activeRun.started_at).getTime() : 0;
    const runAgeMs = runStartedAt > 0 ? Date.now() - runStartedAt : 0;
    let wedgedVisibilityRun = false;

    if (activeRun?.id && runAgeMs > staleVisibilityRunMs) {
      const { count } = await supabase
        .from("visibility_results")
        .select("id", { count: "exact", head: true })
        .eq("run_id", activeRun.id);
      wedgedVisibilityRun = (count ?? 0) === 0;
    }

    if (wedgedVisibilityRun || (isStale && !activeRun)) {
      const recoveryStatus = project.last_scan_at ? "active" : "draft";
      const serviceClient = await createServiceClient();
      if (activeRun?.id && wedgedVisibilityRun) {
        await serviceClient
          .from("visibility_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: "scan_stuck: visibility phase produced no results before timeout",
          })
          .eq("id", activeRun.id)
          .in("status", ["pending", "running"]);
      }
      await serviceClient
        .from("projects")
        .update({ status: recoveryStatus })
        .eq("id", id)
        .eq("status", "scanning");
      status = recoveryStatus;
      recovered = true;
      message = wedgedVisibilityRun
        ? "Scan timed out during AI visibility checks. Please retry the scan."
        : "Scan did not start. Please retry the scan.";
    }
  }

  const { data: score } = await supabase
    .from("scores")
    .select("omnipresence_score")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let progress: {
    visibilityResults: number;
    runStatus: string | null;
    runAgeMinutes: number | null;
  } | null = null;

  if (status === "scanning") {
    const { data: latestRun } = await supabase
      .from("visibility_runs")
      .select("id, status, started_at")
      .eq("project_id", id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestRun?.id) {
      const { count } = await supabase
        .from("visibility_results")
        .select("id", { count: "exact", head: true })
        .eq("run_id", latestRun.id);
      const runAgeMs = latestRun.started_at
        ? Date.now() - new Date(latestRun.started_at).getTime()
        : 0;
      progress = {
        visibilityResults: count ?? 0,
        runStatus: latestRun.status,
        runAgeMinutes: runAgeMs > 0 ? Math.round(runAgeMs / 60_000) : null,
      };
    }
  }

  return NextResponse.json({
    status,
    lastScanAt: project.last_scan_at,
    score: score?.omnipresence_score ?? null,
    recovered,
    message,
    progress,
  });
}
