import type { SupabaseClient } from "@supabase/supabase-js";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { analyzePassageReadiness } from "@/lib/engines/passage-readiness";
import { computeAndRecordFindingDiff } from "@/lib/engines/finding-diff";
import { extractBrandProfile } from "@/lib/engines/brand-extraction";
import { generatePromptUniverse } from "@/lib/engines/prompt-generator";
import { runVisibilityScan, extractCitationSources, persistProbeTraces } from "@/lib/engines/visibility-scanner";
import { getActiveScanEngines } from "@/lib/config/scan-engines";
import { checkPlatformCoverage } from "@/lib/engines/coverage-checker";
import { findAuthorityOpportunities } from "@/lib/engines/authority-finder";
import { generateRoadmap } from "@/lib/engines/roadmap-generator";
import { calculateOmniPresenceScore } from "@/lib/scoring/omnipresence";
import { sendScanCompleteEmail, sendScoreDropAlert } from "@/lib/email/reports";
import { trackApiUsage } from "@/lib/metering/api-usage";
import {
  getPromptGenerationLimit,
  getVisibilityScanPromptLimit,
  getOrganizationPlan,
} from "@/lib/plans/limits";
import { resolveAndPersistCompetitors } from "@/lib/engines/competitor-resolver";
import { syncExecutionTasks, verifyTaskResolution } from "@/lib/engines/execution-tasks";
import { syncFastestPathTasks } from "@/lib/engines/fastest-path-service";
import {
  assessVisibilityRunQuality,
  visibilityRunStatusFromQuality,
} from "@/lib/engines/visibility-run-quality";
import { computeBrandSovFromResults } from "@/lib/engines/share-of-voice";
import { emitWebhookEvent } from "@/lib/notifications/webhooks";
import { buildSourceGraph } from "@/lib/engines/source-graph";
import type {
  Project,
  TechnicalFinding,
  CoverageItem,
  AuthorityOpportunity,
  VisibilityResult,
} from "@/types/database";

function toTechnicalFinding(
  f: Awaited<ReturnType<typeof runTechnicalAudit>>[number],
  projectId: string
): TechnicalFinding {
  return { ...f, project_id: projectId, is_resolved: false, id: "", created_at: "" };
}

export interface ScanResult {
  projectId: string;
  score: number;
  demo: boolean;
}

export async function runProjectScan(
  supabase: SupabaseClient,
  projectId: string,
  options?: { notifyEmail?: string }
): Promise<ScanResult> {
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) throw new Error("Project not found");

  const p = project as Project;
  const plan = await getOrganizationPlan(supabase, p.organization_id);
  const promptCount = getPromptGenerationLimit(plan);
  const maxScanPrompts = getVisibilityScanPromptLimit(plan);

  await supabase.from("projects").update({ status: "scanning" }).eq("id", projectId);

  const technicalFindings = [
    ...(await runTechnicalAudit(p.domain)),
    ...(await analyzePassageReadiness(p.domain)),
  ];
  const scanAuditedAt = new Date().toISOString();
  const findingRows = technicalFindings.map((f) => ({
    ...f,
    project_id: projectId,
    data_source: "measured",
    provider: "site_crawl",
    is_estimated: false,
    last_checked_at: scanAuditedAt,
  }));
  await computeAndRecordFindingDiff(
    supabase,
    projectId,
    technicalFindings.map((f) => f.title)
  ).catch(() => null);
  await supabase.from("technical_findings").delete().eq("project_id", projectId);
  if (findingRows.length > 0) await supabase.from("technical_findings").insert(findingRows);

  const brandProfile = await extractBrandProfile(p.domain, p.name, p.industry);

  await supabase.from("brand_profiles").upsert(
    { project_id: projectId, ...brandProfile },
    { onConflict: "project_id" }
  );

  const services = (brandProfile.products_services || []).map((s) => s.name);
  const prompts = await generatePromptUniverse(
    projectId,
    p.name,
    p.industry || "",
    p.location || "",
    p.competitors || [],
    p.target_buyer || "",
    services,
    promptCount
  );

  await supabase.from("prompts").delete().eq("project_id", projectId);
  if (prompts.length > 0) await supabase.from("prompts").insert(prompts);

  const { data: run } = await supabase
    .from("visibility_runs")
    .insert({
      project_id: projectId,
      status: "running",
      engines: getActiveScanEngines(),
      prompt_count: prompts.length,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  // Replace stale probes so headline metrics always reflect the latest run only.
  await supabase.from("visibility_results").delete().eq("project_id", projectId);
  await supabase.from("ai_probe_traces").delete().eq("project_id", projectId);

  const visibilityResults = await runVisibilityScan({
    projectId,
    runId: run!.id,
    brandName: p.name,
    brandDomain: p.domain,
    competitors: p.competitors || [],
    location: p.location || "United States",
    prompts: prompts.map((pr) => ({ text: pr.text, priority: pr.priority })),
    maxPrompts: maxScanPrompts,
  });

  if (visibilityResults.length > 0) {
    const now = new Date().toISOString();
    const rows = (visibilityResults as unknown as Array<Record<string, unknown>>).map((r) => {
      const ds = (r.data_source as string | undefined) ?? "unavailable";
      return { ...r, data_source: ds, is_estimated: ds !== "measured", last_checked_at: now };
    });
    await supabase.from("visibility_results").insert(rows as never[]);
  }

  if (visibilityResults.length > 0) {
    await persistProbeTraces(
      supabase,
      visibilityResults as import("@/lib/engines/visibility-scanner").VisibilityScanResult[]
    );
  }

  const citationRows = extractCitationSources(
    visibilityResults as import("@/lib/engines/visibility-scanner").VisibilityScanResult[],
    p.competitors || [],
    p.domain
  ).map((row) => ({ ...row, project_id: projectId, run_id: run!.id }));
  await supabase.from("citation_sources").delete().eq("project_id", projectId);
  if (citationRows.length > 0) {
    await supabase.from("citation_sources").insert(citationRows);
  }
  // Rebuild the market-specific Source/Citation Graph from the fresh citations.
  await buildSourceGraph(projectId);

  // A scan with only a handful of SERP hits while every AI engine is unavailable
  // is not a professional result — mark the run failed so the UI prompts re-scan.
  const quality = assessVisibilityRunQuality(
    visibilityResults as import("@/lib/engines/visibility-scanner").VisibilityScanResult[]
  );
  const runStatus = visibilityRunStatusFromQuality(quality);
  const brandSov = computeBrandSovFromResults(
    visibilityResults as unknown as VisibilityResult[],
    p.name,
    p.competitors || []
  );
  await supabase
    .from("visibility_runs")
    .update({
      status: runStatus,
      completed_at: new Date().toISOString(),
      error_message: quality.message,
      brand_sov: brandSov,
    })
    .eq("id", run!.id);

  const coverageItems = await checkPlatformCoverage(
    projectId,
    p.name,
    p.domain,
    p.competitors || []
  );
  await supabase.from("coverage_items").delete().eq("project_id", projectId);
  if (coverageItems.length > 0) await supabase.from("coverage_items").insert(coverageItems);

  const resolvedCompetitors = await resolveAndPersistCompetitors(
    supabase,
    projectId,
    p.competitors || [],
    p.industry || ""
  );

  const authorityOpportunities = await findAuthorityOpportunities(
    projectId,
    p.name,
    p.domain,
    p.industry || "",
    p.competitors || [],
    prompts.map((pr) => pr.text),
    resolvedCompetitors
  );

  await supabase.from("authority_opportunities").delete().eq("project_id", projectId);
  if (authorityOpportunities.length > 0) {
    const authRows = (authorityOpportunities as Array<Record<string, unknown>>).map((o) => ({
      ...o,
      data_source: o.data_source ?? ((o as { measured?: boolean }).measured ? "measured" : "unavailable"),
      provider: o.provider ?? ((o as { measured?: boolean }).measured ? "serp" : "unavailable"),
      is_estimated: o.is_estimated ?? false,
      last_checked_at: o.last_checked_at ?? scanAuditedAt,
    }));
    await supabase.from("authority_opportunities").insert(authRows as never[]);
  }

  const score = calculateOmniPresenceScore({
    visibilityResults: visibilityResults as unknown as VisibilityResult[],
    technicalFindings: technicalFindings.map((f) => toTechnicalFinding(f, projectId)),
    coverageItems: coverageItems as CoverageItem[],
    authorityOpportunities: authorityOpportunities as AuthorityOpportunity[],
    hasConversionTracking: false,
    hasGbp: coverageItems.some((c) => c.surface === "google_business" && c.is_present),
    monthlyTraffic: p.current_monthly_traffic ?? undefined,
  });

  const { data: previousScores } = await supabase
    .from("scores")
    .select("omnipresence_score")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);

  const previousScore = previousScores?.[0]?.omnipresence_score;

  await supabase.from("scores").insert({ project_id: projectId, ...score });

  const roadmap = await generateRoadmap(
    projectId,
    p.name,
    p.domain,
    p.industry || "",
    p.location || "",
    technicalFindings.map((f) => toTechnicalFinding(f, projectId)),
    coverageItems.filter((c) => !c.is_present) as CoverageItem[],
    authorityOpportunities as AuthorityOpportunity[]
  );

  await supabase.from("roadmaps").delete().eq("project_id", projectId);
  await supabase.from("roadmaps").insert(roadmap);

  // Execution loop: verify resolved tasks, then sync new actions from this scan.
  if (p.organization_id) {
    await verifyTaskResolution(supabase, projectId).catch(() => null);
    await syncExecutionTasks(supabase, projectId, p.organization_id).catch(() => null);
    await syncFastestPathTasks(supabase, projectId, p.organization_id).catch(() => null);
  }

  await supabase.from("projects").update({
    status: "active",
    last_scan_at: new Date().toISOString(),
  }).eq("id", projectId);

  // Notify any configured outbound webhooks (agency integrations). Fire-and-forget.
  void emitWebhookEvent({
    event: "scan.completed",
    projectId,
    data: { omnipresence_score: score.omnipresence_score, domain: p.domain },
  });

  if (options?.notifyEmail) {
    await sendScanCompleteEmail(options.notifyEmail, p.name, score.omnipresence_score, projectId);

    if (previousScore !== undefined && previousScore > score.omnipresence_score) {
      await sendScoreDropAlert(
        options.notifyEmail,
        p.name,
        previousScore,
        score.omnipresence_score,
        projectId
      );
    }
  }

  if (p.organization_id) {
    const providerCredits: Record<string, number> = {};
    for (const r of visibilityResults) {
      const detail =
        (r as { raw_response?: { data_source_detail?: string } }).raw_response?.data_source_detail ||
        "unknown";
      providerCredits[detail] = (providerCredits[detail] || 0) + 1;
    }
    for (const [provider, count] of Object.entries(providerCredits)) {
      await trackApiUsage(supabase, p.organization_id, provider, "visibility_scan", count);
    }
    const credits = Math.max(visibilityResults.length, prompts.length, 10);
    await trackApiUsage(supabase, p.organization_id, "presenceos", "full_scan", credits);
  }

  return { projectId, score: score.omnipresence_score, demo: false };
}

export async function getOwnerEmail(
  supabase: SupabaseClient,
  organizationId: string
): Promise<string | undefined> {
  const { data: org } = await supabase
    .from("organizations")
    .select("memberships(profiles(email))")
    .eq("id", organizationId)
    .single();

  const memberships = (org as unknown as { memberships?: Array<{ profiles?: { email: string } }> })?.memberships;
  return memberships?.[0]?.profiles?.email;
}
