/**
 * Discrete scan steps for Inngest orchestration (v2)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { analyzePassageReadiness } from "@/lib/engines/passage-readiness";
import { extractBrandProfile } from "@/lib/engines/brand-extraction";
import { generatePromptUniverse } from "@/lib/engines/prompt-generator";
import { runVisibilityScan, extractCitationSources } from "@/lib/engines/visibility-scanner";
import { SCAN_ENGINES } from "@/lib/config/scan-engines";
import { checkPlatformCoverage } from "@/lib/engines/coverage-checker";
import { findAuthorityOpportunities } from "@/lib/engines/authority-finder";
import { generateRoadmap } from "@/lib/engines/roadmap-generator";
import { calculateOmniPresenceScore } from "@/lib/scoring/omnipresence";
import { recordScanBaseline } from "@/lib/engines/results-ledger";
import { lockGuaranteeBaseline } from "@/lib/engines/guarantee";
import {
  isDemoMode,
  generateDemoPrompts,
  generateDemoVisibilityResults,
  generateDemoBrandProfile,
  generateDemoAuthorityOpportunities,
} from "@/lib/demo/scan-data";
import { getPromptGenerationLimit, getVisibilityScanPromptLimit } from "@/lib/plans/limits";
import type { Project } from "@/types/database";

export async function stepTechnicalAudit(supabase: SupabaseClient, projectId: string, domain: string) {
  const findings = [...(await runTechnicalAudit(domain)), ...(await analyzePassageReadiness(domain))];
  const rows = findings.map((f) => ({ ...f, project_id: projectId }));
  await supabase.from("technical_findings").delete().eq("project_id", projectId);
  if (rows.length) await supabase.from("technical_findings").insert(rows);
  return findings;
}

export async function stepBrandExtract(supabase: SupabaseClient, project: Project) {
  const demo = isDemoMode();
  const brandProfile = demo
    ? generateDemoBrandProfile(project.name, project.industry || "business")
    : await extractBrandProfile(project.domain, project.name, project.industry);

  await supabase.from("brand_profiles").upsert(
    { project_id: project.id, ...brandProfile },
    { onConflict: "project_id" }
  );
  return brandProfile;
}

export async function stepVisibilityScan(supabase: SupabaseClient, project: Project) {
  const demo = isDemoMode();
  const promptCount = getPromptGenerationLimit();
  const maxScanPrompts = getVisibilityScanPromptLimit();

  const { data: brand } = await supabase.from("brand_profiles").select("*").eq("project_id", project.id).single();
  const services = (brand?.products_services || []).map((s: { name: string }) => s.name);

  const prompts = demo
    ? generateDemoPrompts(project.id, project.name, project.industry || "", project.location || "", project.competitors || [])
    : await generatePromptUniverse(
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

  const { data: run } = await supabase
    .from("visibility_runs")
    .insert({
      project_id: project.id,
      status: "running",
      engines: SCAN_ENGINES,
      prompt_count: prompts.length,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  const visibilityResults = demo
    ? generateDemoVisibilityResults(
        project.id,
        run!.id,
        project.name,
        project.domain,
        project.competitors || [],
        prompts.map((pr) => ({ text: pr.text }))
      )
    : await runVisibilityScan({
        projectId: project.id,
        runId: run!.id,
        brandName: project.name,
        brandDomain: project.domain,
        competitors: project.competitors || [],
        location: project.location || "United States",
        prompts: prompts.map((pr) => ({ text: pr.text, priority: pr.priority })),
        maxPrompts: maxScanPrompts,
      });

  if (visibilityResults.length) {
    await supabase.from("visibility_results").insert(visibilityResults as never[]);
  }

  if (!demo) {
    const citationRows = extractCitationSources(
      visibilityResults as import("@/lib/engines/visibility-scanner").VisibilityScanResult[],
      project.competitors || [],
      project.domain
    ).map((row) => ({ ...row, project_id: project.id, run_id: run!.id }));
    await supabase.from("citation_sources").delete().eq("project_id", project.id);
    if (citationRows.length) await supabase.from("citation_sources").insert(citationRows);
  }

  await supabase
    .from("visibility_runs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", run!.id);

  return { prompts, visibilityResults, runId: run!.id };
}

export async function stepScoreAndRoadmap(
  supabase: SupabaseClient,
  project: Project,
  technicalFindings: Awaited<ReturnType<typeof stepTechnicalAudit>>
) {
  const demo = isDemoMode();

  const coverageItems = await checkPlatformCoverage(
    project.id,
    project.name,
    project.domain,
    project.competitors || []
  );
  await supabase.from("coverage_items").delete().eq("project_id", project.id);
  if (coverageItems.length) await supabase.from("coverage_items").insert(coverageItems);

  const { data: prompts } = await supabase.from("prompts").select("text").eq("project_id", project.id);
  const authorityOpportunities = demo
    ? generateDemoAuthorityOpportunities(project.id, project.industry || "", project.competitors || [])
    : await findAuthorityOpportunities(
        project.id,
        project.name,
        project.domain,
        project.industry || "",
        project.competitors || [],
        (prompts || []).map((p) => p.text)
      );

  await supabase.from("authority_opportunities").delete().eq("project_id", project.id);
  if (authorityOpportunities.length) {
    await supabase.from("authority_opportunities").insert(authorityOpportunities as never[]);
  }

  const { data: visibilityResults } = await supabase
    .from("visibility_results")
    .select("*")
    .eq("project_id", project.id);

  const score = calculateOmniPresenceScore({
    visibilityResults: visibilityResults || [],
    technicalFindings: technicalFindings.map((f) => ({ ...f, project_id: project.id, is_resolved: false, id: "", created_at: "" })),
    coverageItems: coverageItems as never[],
    authorityOpportunities: authorityOpportunities as never[],
    hasConversionTracking: false,
    hasGbp: coverageItems.some((c) => c.surface === "google_business" && c.is_present),
    monthlyTraffic: project.current_monthly_traffic ?? undefined,
  });

  await supabase.from("scores").insert({ project_id: project.id, ...score });

  const roadmap = await generateRoadmap(
    project.id,
    project.name,
    project.domain,
    project.industry || "",
    project.location || "",
    technicalFindings.map((f) => ({ ...f, project_id: project.id, is_resolved: false, id: "", created_at: "" })),
    coverageItems.filter((c) => !c.is_present) as never[],
    authorityOpportunities as never[]
  );

  await supabase.from("roadmaps").delete().eq("project_id", project.id);
  await supabase.from("roadmaps").insert(roadmap);

  await recordScanBaseline(supabase, project.id, {
    omnipresence_score: score.omnipresence_score,
    ai_visibility: score.ai_visibility,
    citation_count: (visibilityResults || []).filter((r) => r.brand_cited).length,
    measured_at: new Date().toISOString(),
  });

  const { data: existingContract } = await supabase
    .from("guarantee_contracts")
    .select("id")
    .eq("project_id", project.id)
    .maybeSingle();

  if (!existingContract) {
    await lockGuaranteeBaseline(supabase, project.id, {
      omnipresence_score: score.omnipresence_score,
      citation_rate: score.ai_visibility ?? 0,
      visibility_mention_rate: score.ai_visibility ?? 0,
    });
  }

  return { score, coverageItems, authorityOpportunities };
}
