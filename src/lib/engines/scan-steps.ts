/**
 * Discrete scan steps for Inngest orchestration (v2)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { runTechnicalAudit } from "@/lib/engines/technical-audit";
import { analyzePassageReadiness } from "@/lib/engines/passage-readiness";
import { extractBrandProfile } from "@/lib/engines/brand-extraction";
import { generatePromptUniverse, generateTemplatePrompts } from "@/lib/engines/prompt-generator";
import { runVisibilityScan, extractCitationSources } from "@/lib/engines/visibility-scanner";
import { SCAN_ENGINES } from "@/lib/config/scan-engines";
import { checkPlatformCoverage } from "@/lib/engines/coverage-checker";
import { findAuthorityOpportunities } from "@/lib/engines/authority-finder";
import { generateRoadmap } from "@/lib/engines/roadmap-generator";
import { calculateOmniPresenceScore } from "@/lib/scoring/omnipresence";
import { calculateAeoReadiness } from "@/lib/engines/aeo-readiness";
import { getAuthorityRating } from "@/lib/engines/authority-rating";
import { getPageSpeed, pageSpeedToRetrievalScore } from "@/lib/providers/pagespeed";
import { hasWikipediaPresence, hasWikidataEntity } from "@/lib/providers/wikimedia";
import { conversionSignalFromRows } from "@/lib/engines/behavior-analytics";
import { recordScanBaseline } from "@/lib/engines/results-ledger";
import { lockGuaranteeBaseline } from "@/lib/engines/guarantee";
import { syncTechnicalFindingsToOpsQueue } from "@/lib/engines/on-page-queue";
import {
  generateDemoPrompts,
  generateDemoVisibilityResults,
  generateDemoBrandProfile,
  generateDemoAuthorityOpportunities,
} from "@/lib/demo/scan-data";
import { getPromptGenerationLimit, getVisibilityScanPromptLimit } from "@/lib/plans/limits";
import { resolveAndPersistCompetitors } from "@/lib/engines/competitor-resolver";
import { syncExecutionTasks, verifyTaskResolution } from "@/lib/engines/execution-tasks";
import { computeAndRecordFindingDiff } from "@/lib/engines/finding-diff";
import type { Project, AuthorityOpportunity } from "@/types/database";

export async function stepTechnicalAudit(supabase: SupabaseClient, projectId: string, domain: string) {
  const findings = [...(await runTechnicalAudit(domain)), ...(await analyzePassageReadiness(domain))];
  const auditedAt = new Date().toISOString();
  // Technical findings are always real measured site fetches (robots/sitemap/HTML
  // crawl + PageSpeed), so stamp them measured with the crawl as provider.
  const rows = findings.map((f) => ({
    ...f,
    project_id: projectId,
    data_source: "measured",
    provider: "site_crawl",
    is_estimated: false,
    last_checked_at: auditedAt,
  }));
  // Crawl diff: record new/fixed/regressed vs the prior scan BEFORE we replace.
  await computeAndRecordFindingDiff(
    supabase,
    projectId,
    findings.map((f) => f.title)
  ).catch(() => null);
  // Only swap findings if we have a fresh set, so a failed crawl can't wipe the
  // last good audit and leave the project looking "clean".
  if (rows.length) {
    await supabase.from("technical_findings").delete().eq("project_id", projectId);
    await supabase.from("technical_findings").insert(rows);
  }

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (project?.organization_id) {
    await syncTechnicalFindingsToOpsQueue(
      supabase,
      projectId,
      project.organization_id,
      findings
    );
  }

  return findings;
}

export async function stepBrandExtract(supabase: SupabaseClient, project: Project, demo: boolean) {
  const brandProfile = demo
    ? generateDemoBrandProfile(project.name, project.industry || "business")
    : await extractBrandProfile(project.domain, project.name, project.industry);

  await supabase.from("brand_profiles").upsert(
    { project_id: project.id, ...brandProfile },
    { onConflict: "project_id" }
  );
  return brandProfile;
}

export async function stepVisibilityScan(supabase: SupabaseClient, project: Project, demo: boolean) {
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
      ).then((p) =>
        p.length > 0
          ? p
          : generateTemplatePrompts(
              project.id,
              project.name,
              project.industry || "",
              project.location || "",
              project.competitors || [],
              services
            )
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
    const now = new Date().toISOString();
    const rows = (visibilityResults as Array<Record<string, unknown>>).map((r) => {
      const ds = (r.data_source as string | undefined) ?? (demo ? "simulated" : undefined);
      return {
        ...r,
        data_source: ds,
        is_estimated: ds !== "measured",
        last_checked_at: now,
      };
    });
    await supabase.from("visibility_results").insert(rows as never[]);
  }

  const measuredCount = visibilityResults.filter(
    (r) => (r as { data_source?: string }).data_source === "measured"
  ).length;
  const runStatus = demo ? "completed" : measuredCount === 0 ? "failed" : "completed";

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
    .update({
      status: runStatus,
      completed_at: new Date().toISOString(),
      error_message: runStatus === "failed" ? "No live visibility measurements — check API keys (SERP + LLM)" : null,
    })
    .eq("id", run!.id);

  return { prompts, visibilityResults, runId: run!.id };
}

export async function stepScoreAndRoadmap(
  supabase: SupabaseClient,
  project: Project,
  technicalFindings: Awaited<ReturnType<typeof stepTechnicalAudit>>,
  demo: boolean
) {
  const coverageItems = await checkPlatformCoverage(
    project.id,
    project.name,
    project.domain,
    project.competitors || []
  );
  await supabase.from("coverage_items").delete().eq("project_id", project.id);
  if (coverageItems.length) await supabase.from("coverage_items").insert(coverageItems);

  const { data: prompts } = await supabase.from("prompts").select("text").eq("project_id", project.id);

  // Resolve competitor names to real domains (SERP, confidence-scored) and
  // persist them so backlink/citation gaps use confirmed domains — never a
  // name+".com" guess.
  const resolvedCompetitors = demo
    ? []
    : await resolveAndPersistCompetitors(
        supabase,
        project.id,
        project.competitors || [],
        project.industry || ""
      );

  const authorityOpportunities = demo
    ? generateDemoAuthorityOpportunities(project.id, project.industry || "", project.competitors || [])
    : await findAuthorityOpportunities(
        project.id,
        project.name,
        project.domain,
        project.industry || "",
        project.competitors || [],
        (prompts || []).map((p) => p.text),
        resolvedCompetitors
      );

  await supabase.from("authority_opportunities").delete().eq("project_id", project.id);
  if (authorityOpportunities.length) {
    // Stamp provenance so the UI/report can label each opportunity Live vs
    // Estimated: SERP/backlink-derived rows are measured; AI-suggested rows
    // (directories/podcasts/communities) are estimated.
    const nowIso = new Date().toISOString();
    const authorityRows = authorityOpportunities.map((o) => {
      const oo = o as AuthorityOpportunity;
      return {
        ...o,
        data_source: oo.data_source ?? (demo ? "simulated" : oo.measured ? "measured" : "estimated"),
        provider: oo.provider ?? (demo ? "demo" : oo.measured ? "serp" : "ai_suggested"),
        is_estimated: oo.is_estimated ?? (demo ? true : !oo.measured),
        last_checked_at: oo.last_checked_at ?? nowIso,
      };
    });
    await supabase.from("authority_opportunities").insert(authorityRows as never[]);
  }

  const { data: visibilityResults } = await supabase
    .from("visibility_results")
    .select("*")
    .eq("project_id", project.id);

  // Free authority + page-speed signals (graceful when unreachable). Authority
  // is the unified Authority Rating (Tranco + Common Crawl + OpenPageRank + age).
  const [authRes, psRes, wikiPresence, wikidataPresence] = demo
    ? [null, null, false, false]
    : await Promise.all([
        getAuthorityRating(project.domain).catch(() => null),
        getPageSpeed(project.domain, "mobile"),
        hasWikipediaPresence(project.name).catch(() => false),
        hasWikidataEntity(project.name).catch(() => false),
      ]);
  const domainAuthority = authRes?.rating;
  const pageSpeedScore = psRes?.success && psRes.data ? pageSpeedToRetrievalScore(psRes.data) : undefined;

  // Blend in measured behavioral health (Microsoft Clarity) when the project
  // has persisted per-URL metrics — recomputed from the same formula as the
  // weekly cron so the conversion signal actually moves the score.
  let behaviorSignal: number | undefined;
  if (!demo) {
    const { data: behaviorRows } = await supabase
      .from("behavior_metrics")
      .select("sessions, rage_clicks, quickbacks, scroll_depth_pct")
      .eq("project_id", project.id);
    if (behaviorRows && behaviorRows.length) {
      behaviorSignal = conversionSignalFromRows(
        behaviorRows.map((r) => ({
          sessions: r.sessions ?? 0,
          rageClicks: r.rage_clicks ?? 0,
          quickbacks: r.quickbacks ?? 0,
          scrollDepthPct: r.scroll_depth_pct,
        }))
      );
    }
  }

  const score = calculateOmniPresenceScore({
    visibilityResults: visibilityResults || [],
    technicalFindings: technicalFindings.map((f) => ({ ...f, project_id: project.id, is_resolved: false, id: "", created_at: "" })),
    coverageItems: coverageItems as never[],
    authorityOpportunities: authorityOpportunities as never[],
    hasConversionTracking: false,
    hasGbp: coverageItems.some((c) => c.surface === "google_business" && c.is_present),
    monthlyTraffic: project.current_monthly_traffic ?? undefined,
    domainAuthority,
    pageSpeedScore,
    behaviorSignal,
  });

  await supabase.from("scores").insert({ project_id: project.id, ...score });

  // 7-lever AEO Readiness (deterministic vs measured)
  const { data: entityProfile } = await supabase
    .from("entity_profiles")
    .select("entity_score")
    .eq("project_id", project.id)
    .maybeSingle();

  const readiness = calculateAeoReadiness({
    technicalFindings,
    visibilityResults: (visibilityResults || []) as never[],
    entityScore: entityProfile?.entity_score ?? undefined,
    hasWikipedia: wikiPresence,
    hasWikidata: wikidataPresence,
    coverageItems: coverageItems as never[],
    authorityOpportunities: authorityOpportunities as never[],
    domainAuthority,
    pageSpeedScore,
  });

  await supabase.from("aeo_readiness").upsert(
    {
      project_id: project.id,
      readiness_score: readiness.readinessScore,
      deterministic_score: readiness.deterministicScore,
      probabilistic_score: readiness.probabilisticScore,
      levers: readiness.levers,
      deterministic_deliverables_met: readiness.deterministicDeliverablesMet,
      next_best_actions: readiness.nextBestActions,
      domain_authority: domainAuthority ?? null,
      page_speed_score: pageSpeedScore ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );

  const roadmap = await generateRoadmap(
    project.id,
    project.name,
    project.domain,
    project.industry || "",
    project.location || "",
    technicalFindings.map((f) => ({ ...f, project_id: project.id, is_resolved: false, id: "", created_at: "" })),
    coverageItems.filter((c) => !c.is_present) as never[],
    authorityOpportunities as never[],
    90,
    readiness.nextBestActions
  );

  // Guard: only replace the roadmap if we actually generated a new one, so a
  // transient generation failure (empty roadmap) never wipes the prior plan.
  if (roadmap.items?.length) {
    await supabase.from("roadmaps").delete().eq("project_id", project.id);
    await supabase.from("roadmaps").insert(roadmap);
  }

  // Execution loop: verify which in-flight tasks were resolved by this re-scan,
  // then turn the fresh findings/gaps/roadmap into newly tracked tasks.
  if (project.organization_id) {
    await verifyTaskResolution(supabase, project.id).catch(() => null);
    await syncExecutionTasks(supabase, project.id, project.organization_id).catch(() => null);
  }

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
