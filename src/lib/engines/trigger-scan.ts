import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import { inngest } from "@/lib/inngest/client";

const DEFAULT_INNGEST_WATCHDOG_MS = 10 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * If Inngest accepted the scan but never produces visibility rows (wedged queue
 * or hung step), take over with the local background runner so users aren't stuck.
 */
function scheduleInngestScanWatchdog(projectId: string, organizationId: string) {
  const watchdogMs = Math.max(
    5 * 60 * 1000,
    Number(process.env.SCAN_INNGEST_WATCHDOG_MS) || DEFAULT_INNGEST_WATCHDOG_MS
  );

  after(async () => {
    await sleep(watchdogMs);
    const supabase = await createServiceClient();

    const { data: project } = await supabase
      .from("projects")
      .select("status, last_scan_at")
      .eq("id", projectId)
      .single();
    if (!project || project.status !== "scanning") return;

    const { data: activeRun } = await supabase
      .from("visibility_runs")
      .select("id, status, started_at")
      .eq("project_id", projectId)
      .in("status", ["pending", "running"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeRun?.id) {
      const { count } = await supabase
        .from("visibility_results")
        .select("id", { count: "exact", head: true })
        .eq("run_id", activeRun.id);
      if ((count ?? 0) > 0) return;

      await supabase
        .from("visibility_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: "scan_watchdog: inngest stalled with zero visibility results; sync takeover",
        })
        .eq("id", activeRun.id)
        .in("status", ["pending", "running"]);
    }

    const email = await getOwnerEmail(supabase, organizationId);
    try {
      console.warn(`Scan watchdog: sync takeover for project ${projectId}`);
      await runProjectScan(supabase, projectId, { notifyEmail: email });
    } catch (error) {
      console.error("Scan watchdog sync takeover failed:", error);
      const recoveryStatus = project.last_scan_at ? "active" : "draft";
      await supabase.from("projects").update({ status: recoveryStatus }).eq("id", projectId);
    }
  });
}

export async function triggerProjectScan(
  projectId: string,
  organizationId: string,
  options?: { idempotencyKey?: string }
): Promise<{ mode: "inngest" | "sync" | "duplicate" }> {
  const idempotencyKey = options?.idempotencyKey;

  // A double-clicked Rescan button (or a retried request from a flaky client)
  // supplying the same key must not spin up a second scan pipeline — mirrors
  // the report-generate idempotency check in
  // src/app/api/projects/[id]/report/route.ts. This only catches the case
  // where the run row already exists (e.g. the first request already got far
  // enough to create it, or a prior Inngest run completed); the
  // in-flight/pre-row-creation race is closed by the atomic
  // status != 'scanning' guard callers apply before invoking this function.
  if (idempotencyKey) {
    const supabase = await createServiceClient();
    const { data: existingRun } = await supabase
      .from("visibility_runs")
      .select("id")
      .eq("project_id", projectId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingRun) {
      return { mode: "duplicate" };
    }
  }

  const scanTriggerMode = process.env.SCAN_TRIGGER_MODE?.toLowerCase();
  const useInngest =
    process.env.INNGEST_EVENT_KEY &&
    (scanTriggerMode === "inngest" || scanTriggerMode === "inngest-only");

  if (useInngest) {
    try {
      await inngest.send({
        name: "project/scan.requested",
        data: { projectId, organizationId, idempotencyKey },
      });
      scheduleInngestScanWatchdog(projectId, organizationId);
      return { mode: "inngest" };
    } catch (error) {
      console.error("Inngest scan trigger failed; falling back to background scan:", error);
      // Fall through to the local background runner.
    }
  }

  after(async () => {
    const supabase = await createServiceClient();
    const email = await getOwnerEmail(supabase, organizationId);
    try {
      await runProjectScan(supabase, projectId, { notifyEmail: email, idempotencyKey });
    } catch (error) {
      console.error("Background scan failed:", error);
      await supabase.from("projects").update({ status: "draft" }).eq("id", projectId);
    }
  });

  return { mode: "sync" };
}
