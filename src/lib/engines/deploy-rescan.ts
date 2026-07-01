/**
 * Deploy → rescan coupling (Wave Q3).
 *
 * When an asset goes live we don't just log it — we re-measure the surfaces it
 * was meant to influence and record an ASSET-SCOPED before/after delta. This
 * extends the proven geo-rewrite loop (baseline → wait → re-probe → lift) but
 * scopes the probe to the handful of prompts the asset targets, so it's cheap
 * and the lift is attributable to THIS deployment.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { runVisibilityScan, persistProbeTraces } from "@/lib/engines/visibility-scanner";
import { measureCitationRate, computeLift, type CitationRateWindow } from "@/lib/engines/geo-rewrite-loop";
import { recordLedgerAction } from "@/lib/engines/results-ledger";
import { logProviderError } from "@/lib/observability/log";

/**
 * Resolve the prompts an asset targets by matching the keyword against the
 * project's measured probe history. Falls back to an empty list (caller then
 * skips scoped scan) rather than guessing.
 */
export async function resolveScopedPrompts(
  supabase: SupabaseClient,
  projectId: string,
  keyword: string | undefined,
  limit = 8
): Promise<string[]> {
  if (!keyword || keyword.trim().length < 3) return [];
  const { data } = await supabase
    .from("ai_probe_traces")
    .select("prompt")
    .eq("project_id", projectId)
    .ilike("prompt", `%${keyword.trim()}%`)
    .limit(200);
  const unique = [...new Set((data || []).map((r) => r.prompt).filter((p): p is string => Boolean(p)))];
  return unique.slice(0, limit);
}

interface ProjectLite {
  id: string;
  name: string;
  domain: string;
  competitors: string[] | null;
  location: string | null;
}

/** Capture the baseline (before) window scoped to the asset's prompts. */
export async function captureDeployBaseline(
  supabase: SupabaseClient,
  projectId: string,
  prompts: string[],
  lookbackDays = 30
): Promise<CitationRateWindow> {
  const sinceISO = new Date(Date.now() - lookbackDays * 86400_000).toISOString();
  return measureCitationRate(supabase, projectId, { sinceISO, prompts });
}

/**
 * Run a targeted re-probe over the asset's prompts and persist the traces so the
 * after-window can be measured. Returns the re-probe start timestamp.
 */
export async function targetedReprobe(
  supabase: SupabaseClient,
  project: ProjectLite,
  prompts: string[]
): Promise<string> {
  const startISO = new Date().toISOString();
  if (!prompts.length) return startISO;
  const runId = crypto.randomUUID();
  const results = await runVisibilityScan({
    projectId: project.id,
    runId,
    brandName: project.name,
    brandDomain: project.domain,
    competitors: project.competitors || [],
    location: project.location || "United States",
    prompts: prompts.map((text) => ({ text })),
    maxPrompts: prompts.length,
  });
  await persistProbeTraces(supabase as never, results).catch(() => 0);
  return startISO;
}

/** Record the asset-scoped before/after delta to the results ledger. */
export async function recordDeployDelta(
  supabase: SupabaseClient,
  projectId: string,
  url: string,
  before: CitationRateWindow,
  after: CitationRateWindow,
  taskId?: string
): Promise<void> {
  const lift = computeLift(before, after);
  await recordLedgerAction(supabase, {
    project_id: projectId,
    task_id: taskId,
    action_type: "deploy_rescan_measured",
    action_surface: "content",
    description: `Asset-scoped lift for ${url}: ${lift.citationLiftPp >= 0 ? "+" : ""}${lift.citationLiftPp}pp citations, ${lift.mentionLiftPp >= 0 ? "+" : ""}${lift.mentionLiftPp}pp mentions`,
    baseline_snapshot: {
      url,
      citation_rate: before.citationRate,
      mention_rate: before.mentionRate,
      probes: before.probes,
    },
    outcome_snapshot: {
      url,
      citation_rate: after.citationRate,
      mention_rate: after.mentionRate,
      probes: after.probes,
      data_source: "measured",
    },
    delta_summary: {
      citation_lift_pp: lift.citationLiftPp,
      mention_lift_pp: lift.mentionLiftPp,
    },
    status: lift.citationLiftPp > 0 || lift.mentionLiftPp > 0 ? "verified" : "completed",
  }).catch((e) => logProviderError("deployRescan.record", e, { projectId, url }));
}

/** Post-deploy verifier: HTTP 200 + optional schema marker + IndexNow ping. */
export async function verifyDeployment(url: string, domain: string): Promise<{
  ok: boolean;
  httpStatus?: number;
  hasSchema?: boolean;
  indexNowSubmitted?: number;
  error?: string;
}> {
  try {
    const { submitIndexNow } = await import("@/lib/engines/indexnow");
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const hasSchema = /application\/ld\+json/i.test(html) || /schema\.org/i.test(html);
    const indexNowSubmitted = res.ok ? await submitIndexNow([url], domain).catch(() => 0) : 0;
    return {
      ok: res.ok,
      httpStatus: res.status,
      hasSchema,
      indexNowSubmitted,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "verify failed" };
  }
}
