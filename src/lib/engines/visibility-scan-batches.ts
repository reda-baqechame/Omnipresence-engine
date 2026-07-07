import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, VisibilityEngine } from "@/types/database";
import { generatePromptUniverse } from "@/lib/engines/prompt-generator";
import {
  runVisibilityScan,
  extractCitationSources,
  persistProbeTraces,
  makeRunCancellationChecker,
  type VisibilityScanResult,
} from "@/lib/engines/visibility-scanner";
import { getActiveScanEngines } from "@/lib/config/scan-engines";
import { attachEvidenceToResults } from "@/lib/engines/evidence";
import { buildSourceGraph, enrichSourceDomainAuthority } from "@/lib/engines/source-graph";
import { createTopInfluenceOutreachTasks, scoreSourceInfluenceV2 } from "@/lib/engines/source-influence";
import { getPromptGenerationLimit, getEffectiveVisibilityScanPromptLimit, getOrganizationPlan } from "@/lib/plans/limits";
import {
  assessVisibilityRunQuality,
  visibilityRunStatusFromQuality,
} from "@/lib/engines/visibility-run-quality";
import { computeBrandSovFromResults } from "@/lib/engines/share-of-voice";
import type { VisibilityResult } from "@/types/database";

async function withStepTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface VisibilityScanPrep {
  runId: string;
  prompts: Array<{ id?: string; text: string; priority?: number }>;
  maxScanPrompts: number;
}

async function loadPromptsForScan(supabase: SupabaseClient, project: Project) {
  const plan = await getOrganizationPlan(supabase, project.organization_id);
  const promptCount = getPromptGenerationLimit(plan);
  const isFirstScan = !project.last_scan_at;
  const maxScanPrompts = getEffectiveVisibilityScanPromptLimit(plan, isFirstScan);

  const { data: brand } = await supabase.from("brand_profiles").select("*").eq("project_id", project.id).single();
  const services = (brand?.products_services || []).map((s: { name: string }) => s.name);

  const prompts = await generatePromptUniverse(
    project.id,
    project.name,
    project.industry || "",
    project.location || "",
    project.competitors || [],
    project.target_buyer || "",
    services,
    promptCount
  );

  await supabase.from("prompts").delete().eq("project_id", project.id);
  if (prompts.length) await supabase.from("prompts").insert(prompts);

  return {
    maxScanPrompts,
    prompts: prompts.map((pr) => ({ text: pr.text, priority: pr.priority })),
  };
}

export async function prepareVisibilityScan(
  supabase: SupabaseClient,
  project: Project
): Promise<VisibilityScanPrep> {
  const { prompts, maxScanPrompts } = await loadPromptsForScan(supabase, project);

  const { data: run } = await supabase
    .from("visibility_runs")
    .insert({
      project_id: project.id,
      status: "running",
      engines: getActiveScanEngines(),
      prompt_count: prompts.length,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  await supabase.from("visibility_results").delete().eq("project_id", project.id);
  await supabase.from("ai_probe_traces").delete().eq("project_id", project.id);

  return { runId: run!.id, prompts, maxScanPrompts };
}

export async function insertVisibilityResultRows(
  supabase: SupabaseClient,
  visibilityResults: VisibilityScanResult[]
) {
  if (!visibilityResults.length) return;

  const now = new Date().toISOString();
  const rows = (visibilityResults as unknown as Array<Record<string, unknown>>).map((r) => {
    const ds = (r.data_source as string | undefined) ?? "unavailable";
    return {
      ...r,
      data_source: ds,
      is_estimated: ds !== "measured",
      last_checked_at: now,
    };
  });
  await supabase.from("visibility_results").insert(rows as never[]);
  await persistProbeTraces(supabase, visibilityResults);
}

export async function persistVisibilityBatch(
  supabase: SupabaseClient,
  projectId: string,
  runId: string,
  visibilityResults: VisibilityScanResult[]
) {
  if (!visibilityResults.length) return;

  await attachEvidenceToResults(
    supabase,
    projectId,
    runId,
    visibilityResults as unknown as Parameters<typeof attachEvidenceToResults>[3]
  ).catch(() => 0);

  await insertVisibilityResultRows(supabase, visibilityResults);
}

export interface VisibilityEngineBatchResult {
  results: VisibilityScanResult[];
  scanPartial: boolean;
  cancelled: boolean;
}

export async function runVisibilityEngineBatch(
  supabase: SupabaseClient,
  project: Project,
  prep: VisibilityScanPrep,
  engine: VisibilityEngine
): Promise<VisibilityEngineBatchResult> {
  const { results, scanPartial, cancelled } = await runVisibilityScan({
    projectId: project.id,
    runId: prep.runId,
    organizationId: project.organization_id,
    brandName: project.name,
    brandDomain: project.domain,
    competitors: project.competitors || [],
    location: project.location || "United States",
    prompts: prep.prompts,
    engines: [engine],
    maxPrompts: prep.maxScanPrompts,
    isCancelled: makeRunCancellationChecker(supabase, prep.runId),
    onProbeResult: async (result) => {
      await insertVisibilityResultRows(supabase, [result]);
    },
  });
  return { results, scanPartial, cancelled };
}

export async function finalizeVisibilityScan(
  supabase: SupabaseClient,
  project: Project,
  runId: string,
  visibilityResults: VisibilityScanResult[],
  options?: { scanPartial?: boolean; cancelled?: boolean }
) {
  // A user-cancelled scan is not "completed with partial data" — it never ran
  // to a conclusion the user asked to see, so it must be labeled cancelled,
  // not silently folded into the ordinary partial/failed quality assessment.
  if (options?.cancelled) {
    await supabase
      .from("visibility_runs")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: "Cancelled by user",
      })
      .eq("id", runId);
    return { quality: null, runStatus: "cancelled" as const };
  }

  const quality = assessVisibilityRunQuality(visibilityResults);
  const runStatus = visibilityRunStatusFromQuality(quality);
  const brandSov = computeBrandSovFromResults(
    visibilityResults as unknown as VisibilityResult[],
    project.name,
    project.competitors || []
  );

  const citationRows = extractCitationSources(visibilityResults, project.competitors || [], project.domain).map(
    (row) => ({ ...row, project_id: project.id, run_id: runId })
  );
  await supabase.from("citation_sources").delete().eq("project_id", project.id);
  if (citationRows.length) await supabase.from("citation_sources").insert(citationRows);

  await withStepTimeout(
    attachEvidenceToResults(
      supabase,
      project.id,
      runId,
      visibilityResults as unknown as Parameters<typeof attachEvidenceToResults>[3]
    ),
    Number(process.env.SCAN_EVIDENCE_TIMEOUT_MS) || 120_000,
    "attach_evidence"
  ).catch(() => 0);

  await withStepTimeout(buildSourceGraph(project.id), 60_000, "source_graph").catch(() => undefined);
  await withStepTimeout(enrichSourceDomainAuthority(supabase, project.id), 60_000, "source_authority").catch(
    () => undefined
  );
  await withStepTimeout(scoreSourceInfluenceV2(supabase, project.id), 45_000, "source_influence").catch(
    () => undefined
  );
  await withStepTimeout(createTopInfluenceOutreachTasks(supabase, project.id, 3), 30_000, "outreach_tasks").catch(
    () => undefined
  );

  await supabase
    .from("visibility_runs")
    .update({
      status: runStatus,
      completed_at: new Date().toISOString(),
      error_message: options?.scanPartial
        ? `scan_partial: true${quality.message ? `. ${quality.message}` : ""}`
        : quality.message,
      brand_sov: brandSov,
    })
    .eq("id", runId);

  return { quality, runStatus };
}
