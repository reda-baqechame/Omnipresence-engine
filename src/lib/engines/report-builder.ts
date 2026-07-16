import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReportHTML, type ReportData } from "@/lib/engines/report-generator";
import { generateReportPDF } from "@/lib/engines/report-pdf";
import { calculateAdsEquivalent } from "@/lib/engines/ads-equivalent";
import { getCachedRealKeywordCpc } from "@/lib/providers/keyword-cpc-cache";
import {
  hasCriticalViolations,
  logReportQualityValidation,
  validateReportClaims,
  type ReportQualityValidationResult,
} from "@/lib/engines/report-quality-gate";
import { persistReportQualityViolations } from "@/lib/engines/report-quality-persistence";
import {
  isReportQualityBlockCriticalEnabled,
  isReportQualitySanitizeEnabled,
  REPORT_QUALITY_BLOCK_MESSAGE,
} from "@/lib/engines/report-quality-flags";
import { sanitizeReportClaims } from "@/lib/engines/report-quality-sanitizer";
import { buildProofReport, renderProofHTML } from "@/lib/engines/proof-report";
import { canUseWhiteLabel } from "@/lib/plans/features";
import { withJobContext } from "@/lib/observability/job-context";
import { createStepProgressTracker } from "@/lib/observability/job-progress";
import { DEEP_REPORT_ALL_STEPS } from "@/lib/engines/report-step-names";
import type { RoadmapItem, SubscriptionPlan, VisibilityResult } from "@/types/database";
import type {
  IntelligenceReport,
  IntelligenceReportBranding,
  IntelligenceReportSectionId,
} from "@/types/intelligence-report";
import type { ReportNarrative } from "@/lib/engines/intelligence-report-narrative";

export interface ReportQualityGateResult {
  report: ReportData | IntelligenceReport;
  narrative?: ReportNarrative;
  validation: ReportQualityValidationResult;
  blocked: boolean;
  sanitizedCount: number;
}

async function markReportQualityBlocked(
  supabase: SupabaseClient,
  reportId: string | undefined
): Promise<void> {
  if (!reportId) return;
  await supabase
    .from("reports")
    .update({
      status: "failed",
      error_message: REPORT_QUALITY_BLOCK_MESSAGE,
      current_step: null,
      progress_percent: 100,
    })
    .eq("id", reportId);
}

async function applyReportQualityGate(
  supabase: SupabaseClient,
  report: ReportData | IntelligenceReport,
  ctx: {
    reportType: "standard" | "deep_intelligence";
    projectId: string;
    reportId?: string;
    orgId?: string | null;
    renderPath: string;
    narrative?: ReportNarrative;
    htmlView?: boolean;
  }
): Promise<ReportQualityGateResult> {
  const fallback: ReportQualityGateResult = {
    report,
    narrative: ctx.narrative,
    validation: { passed: true, violations: [], inventory: [] },
    blocked: false,
    sanitizedCount: 0,
  };

  try {
    const validation = validateReportClaims(report, {
      narrative: ctx.narrative,
      projectId: ctx.projectId,
      orgId: ctx.orgId ?? undefined,
    });
    logReportQualityValidation(validation, {
      reportType: ctx.reportType === "standard" ? "standard" : "deep",
      projectId: ctx.projectId,
      reportId: ctx.reportId,
    });

    const blockEnabled = isReportQualityBlockCriticalEnabled();
    const blocked = blockEnabled && hasCriticalViolations(validation);

    const sanitizeMode = isReportQualitySanitizeEnabled() ? "sanitize" : "observe";
    const sanitized = sanitizeReportClaims(
      report,
      validation,
      {
        mode: sanitizeMode,
        reportType: ctx.htmlView
          ? "html_view"
          : ctx.reportType === "standard"
            ? "standard"
            : "deep_intelligence",
      },
      ctx.narrative
    );

    await persistReportQualityViolations({
      supabase,
      result: validation,
      reportType: ctx.reportType,
      projectId: ctx.projectId,
      orgId: ctx.orgId ?? null,
      reportId: ctx.reportId ?? null,
      renderPath: ctx.renderPath,
      sanitizedCount: sanitized.sanitizedCount,
    });

    if (blocked) {
      await markReportQualityBlocked(supabase, ctx.reportId);
    }

    return {
      report: sanitized.report,
      narrative: sanitized.narrative ?? ctx.narrative,
      validation,
      blocked,
      sanitizedCount: sanitized.sanitizedCount,
    };
  } catch {
    // Non-blocking when flags are off; persistence/sanitizer must never block delivery by default.
    return fallback;
  }
}

export interface WhiteLabelBranding {
  name: string;
  color: string;
}

export async function getOrgWhiteLabel(
  supabase: SupabaseClient,
  organizationId: string
): Promise<WhiteLabelBranding | undefined> {
  const { data: org } = await supabase
    .from("organizations")
    .select("white_label_name, white_label_primary_color, plan")
    .eq("id", organizationId)
    .single();

  if (!org?.white_label_name) {
    return undefined;
  }

  // White-label is an agency/enterprise capability (or open under FREE_ACCESS_MODE).
  if (!canUseWhiteLabel(org.plan as SubscriptionPlan)) {
    return undefined;
  }

  return {
    name: org?.white_label_name || "PresenceOS",
    color: org?.white_label_primary_color || "#6366f1",
  };
}

export interface GatherReportDataOptions {
  /**
   * Cooperative cancellation check (Patch C.1 — hostile-audit finding: this
   * function unconditionally called getRealKeywordCpc(), a real billable
   * Google-Ads-Keyword-Planner-backed call, with no cancellation checkpoint
   * at all, so a user who cancelled a deep report immediately could still
   * trigger that one paid lookup before intelligence-report-builder.ts's own
   * first checkpoint ever ran). Checked immediately before the CPC fetch
   * below, not at function entry — the scores/findings/coverage/etc. queries
   * above are cheap, non-billable DB reads with no cost/cancellation reason
   * to gate. Callers that don't support cancellation (standard reports today)
   * simply omit this and get the unchanged, always-fetch behavior.
   */
  isCancelled?: () => boolean | Promise<boolean>;
}

export async function gatherReportData(
  supabase: SupabaseClient,
  projectId: string,
  opts: GatherReportDataOptions = {}
): Promise<{ reportData: ReportData; whiteLabel?: WhiteLabelBranding } | null> {
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return null;

  const [
    { data: scores },
    { data: findings },
    { data: coverage },
    { data: authority },
    { data: roadmap },
    { data: visibility },
    { data: attribution },
  ] = await Promise.all([
    supabase.from("scores").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(2),
    supabase.from("technical_findings").select("*").eq("project_id", projectId),
    supabase.from("coverage_items").select("*").eq("project_id", projectId),
    supabase.from("authority_opportunities").select("*").eq("project_id", projectId).limit(10),
    supabase.from("roadmaps").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).single(),
    supabase.from("visibility_results").select("*").eq("project_id", projectId),
    supabase
      .from("attribution_metrics")
      .select("organic_traffic, ai_referral_traffic, paid_ads_equivalent")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!scores?.[0]) return null;

  const whiteLabel = await getOrgWhiteLabel(supabase, project.organization_id);

  // Fast-upside ("striking distance") keywords: already ranking 4-20, where a
  // small push typically yields the biggest, fastest traffic gain. Real rank data.
  const { data: striking } = await supabase
    .from("rank_keywords")
    .select("keyword, last_position, target_url")
    .eq("project_id", projectId)
    .gte("last_position", 4)
    .lte("last_position", 20)
    .order("last_position", { ascending: true })
    .limit(10);

  const proof = await buildProofReport(supabase, projectId).catch(() => null);
  const proofHtml = proof ? renderProofHTML(proof, whiteLabel?.color) : undefined;

  // Verifiable-receipts appendix: the latest evidence records behind this
  // report's AI numbers, each linking to the public /verify/{id} page.
  const { data: receiptRows } = await supabase
    .from("ai_capture_evidence")
    .select("id, prompt, surface, engine, captured_at, receipt_hash")
    .eq("project_id", projectId)
    .order("captured_at", { ascending: false })
    .limit(12);
  const receipts = (receiptRows || []).map((r) => ({
    id: r.id as string,
    prompt: (r.prompt as string) || "",
    surface: (r.surface as string | null) ?? null,
    engine: (r.engine as string) || "",
    captured_at: (r.captured_at as string) || "",
    chained: Boolean(r.receipt_hash),
  }));

  let realCpc: number | null = null;
  if (attribution) {
    // Keyword inventory for real-CPC lookup: scan-discovered opportunities are
    // the broadest source; fall back to the user's tracked rank keywords.
    const { data: oppRows } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .limit(50);
    let kwList = (oppRows || []).map((k) => k.keyword).filter(Boolean);
    if (!kwList.length) {
      const { data: rankRows } = await supabase
        .from("rank_keywords")
        .select("keyword")
        .eq("project_id", projectId)
        .limit(50);
      kwList = (rankRows || []).map((k) => k.keyword).filter(Boolean);
    }
    // Cancellation checkpoint (Patch C.1): the only paid/OmniData network call
    // in this function is the CPC lookup immediately below — check right
    // before it, not earlier, so a cancel requested mid-gather still skips
    // this specific billable call without needing to also skip the cheap DB
    // reads above.
    const cancelled = kwList.length > 0 && opts.isCancelled ? await opts.isCancelled() : false;
    if (kwList.length && !cancelled) {
      realCpc = await getCachedRealKeywordCpc(supabase, kwList);
    }
  }

  const adsEquivalent = attribution
    ? calculateAdsEquivalent({
        organicSessions: attribution.organic_traffic ?? 0,
        aiReferralSessions: attribution.ai_referral_traffic ?? 0,
        monthlyAdSpend: project.monthly_ad_spend ?? 0,
        industry: project.industry,
        customCpc: realCpc ?? undefined,
      })
    : undefined;

  const reportData: ReportData = {
    project,
    score: scores[0],
    previousScore: scores[1],
    technicalFindings: findings || [],
    coverageItems: coverage || [],
    authorityOpportunities: authority || [],
    roadmapItems: (roadmap?.items || []) as RoadmapItem[],
    visibilityResults: (visibility || []) as VisibilityResult[],
    strikingKeywords: (striking || []).map((k) => ({
      keyword: k.keyword as string,
      position: k.last_position as number,
      url: (k.target_url as string) || undefined,
    })),
    generatedAt: new Date().toISOString(),
    proofHtml,
    receipts,
    verifyBaseUrl: process.env.NEXT_PUBLIC_APP_URL || "",
    adsEquivalent: adsEquivalent
      ? {
          totalOrganicValue: adsEquivalent.totalOrganicValue,
          replacementRatio: adsEquivalent.replacementRatio,
          statedAdSpend: adsEquivalent.statedAdSpend,
          cpcSource: adsEquivalent.cpcSource,
        }
      : undefined,
  };

  return { reportData, whiteLabel };
}

export async function saveReportArtifacts(
  supabase: SupabaseClient,
  projectId: string,
  reportId: string,
  reportData: ReportData,
  whiteLabel?: WhiteLabelBranding
): Promise<string> {
  return withJobContext({ reportId }, async () => {
    const gate = await applyReportQualityGate(supabase, reportData, {
      reportType: "standard",
      projectId,
      reportId,
      orgId: reportData.project.organization_id,
      renderPath: "save_report_artifacts",
    });
    if (gate.blocked) return "";

    const outputReport = gate.report as ReportData;
    const html = generateReportHTML(outputReport, whiteLabel);
    const htmlFileName = `reports/${projectId}/${reportId}.html`;
    const pdfFileName = `reports/${projectId}/${reportId}.pdf`;

    let pdfStoragePath: string | null = null;
    let htmlStoragePath: string | null = null;

    try {
      const pdfBuffer = await generateReportPDF(outputReport, whiteLabel);
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf", upsert: true });
      if (!uploadError) pdfStoragePath = pdfFileName;
    } catch {
      // PDF optional — degraded state recorded below
    }

    try {
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(htmlFileName, html, { contentType: "text/html", upsert: true });
      if (!uploadError) htmlStoragePath = htmlFileName;
    } catch {
      // HTML upload failed — the report row still records `ready`; the download
      // route falls back to regenerating HTML on demand from live project data.
    }

    await supabase
      .from("reports")
      .update({
        pdf_storage_path: pdfStoragePath,
        html_storage_path: htmlStoragePath,
        pdf_degraded: !pdfStoragePath,
        white_label: !!whiteLabel,
        status: "ready",
        // Patch D: standard reports don't run through a step tracker (no
        // named sub-steps, no cancellation support upstream), but the final
        // write should still leave a truthful terminal state instead of the
        // stale mid-generation step/percent a caller may have set.
        current_step: null,
        progress_percent: 100,
      })
      .eq("id", reportId);

    return pdfStoragePath || htmlStoragePath || "";
  });
}

type IntelligenceGathered = { report: IntelligenceReport; branding?: IntelligenceReportBranding };

interface FinalizeIntelligenceReportDeps {
  generateReportNarrative: (report: IntelligenceReport, opts: { useLlm?: boolean }) => Promise<ReportNarrative>;
  generateIntelligenceReportHTML: (
    report: IntelligenceReport,
    branding: IntelligenceReportBranding | undefined,
    narrative: ReportNarrative
  ) => string;
  renderReportPdf: (html: string) => Promise<Buffer | null>;
  /**
   * Patch D: fired at the start of each named finalize-phase step
   * ("narrative_generation", "pdf_render", "finalizing") so a real progress
   * tracker (see saveIntelligenceReportArtifacts) can write truthful
   * current_step/progress_percent. Optional and unused by existing tests'
   * stub deps — they simply never observe a progress write, exactly as
   * before this patch.
   */
  onStep?: (stepName: string) => void | Promise<void>;
}

/**
 * Cancellation-aware "finish the deep report" step, split out from
 * saveIntelligenceReportArtifacts so it can be unit tested with stubbed deps
 * instead of the real dynamic-imported provider/PDF-rendering chain (mirrors
 * why report-section-selection.ts was extracted from
 * intelligence-report-builder.ts). Given already-gathered report data, this
 * runs narrative generation + PDF/HTML rendering + upload + the final status
 * write — the exact span of work a cancelled job must not pay for or present
 * as "ready".
 */
export async function finalizeIntelligenceReport(
  supabase: SupabaseClient,
  projectId: string,
  reportId: string,
  gathered: IntelligenceGathered,
  deps: FinalizeIntelligenceReportDeps,
  isCancelled?: () => Promise<boolean>
): Promise<string> {
  const markCancelled = async () => {
    await supabase
      .from("reports")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        error_message: "Cancelled by user",
      })
      .eq("id", reportId);
    return "";
  };

  // Cooperative cancellation checkpoint (P0 fix): gatherIntelligenceReport's
  // internal Promise.all fan-out cannot be interrupted mid-flight without a
  // larger architectural change (splitting it into a sequential per-section
  // pipeline — tracked separately), but the narrative LLM call and PDF
  // render that follow are both real, billable, avoidable work. A user who
  // clicked Stop while the fan-out was in flight must not still get a final
  // "ready" report and must not be billed for the narrative/PDF step.
  if (isCancelled && (await isCancelled())) {
    return markCancelled();
  }

  const orgId =
    "meta" in gathered.report && gathered.report.meta?.project
      ? gathered.report.meta.project.organization_id
      : null;

  const preGate = await applyReportQualityGate(supabase, gathered.report, {
    reportType: "deep_intelligence",
    projectId,
    reportId,
    orgId,
    renderPath: "finalize_intelligence_report_pre_narrative",
  });
  if (preGate.blocked) return "";

  if (deps.onStep) await deps.onStep("narrative_generation");
  const narrative = await deps.generateReportNarrative(gathered.report, { useLlm: true });

  const postGate = await applyReportQualityGate(supabase, gathered.report, {
    reportType: "deep_intelligence",
    projectId,
    reportId,
    orgId,
    renderPath: "finalize_intelligence_report",
    narrative,
  });
  if (postGate.blocked) return "";

  const reportForRender = postGate.report as IntelligenceReport;
  const narrativeForRender = postGate.narrative ?? narrative;

  const html = deps.generateIntelligenceReportHTML(
    reportForRender,
    gathered.branding,
    narrativeForRender
  );
  const htmlFileName = `reports/${projectId}/${reportId}.html`;
  const pdfFileName = `reports/${projectId}/${reportId}.pdf`;

  let pdfStoragePath: string | null = null;
  let htmlStoragePath: string | null = null;

  if (deps.onStep) await deps.onStep("pdf_render");
  const pdfBuffer = await deps.renderReportPdf(html);
  if (pdfBuffer) {
    const { error: uploadError } = await supabase.storage
      .from("reports")
      .upload(pdfFileName, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (!uploadError) pdfStoragePath = pdfFileName;
  }

  try {
    const { error: uploadError } = await supabase.storage
      .from("reports")
      .upload(htmlFileName, html, { contentType: "text/html", upsert: true });
    if (!uploadError) htmlStoragePath = htmlFileName;
  } catch {
    // HTML upload failed — download route falls back to on-demand HTML render.
  }

  // Second checkpoint: the narrative LLM call and (especially) the Playwright
  // PDF render above can take tens of seconds — long enough for a cancel
  // requested mid-render to still land before we'd otherwise flip the row to
  // "ready". Re-check and, if cancelled, discard the artifacts we just
  // generated (they're already paid for, but we must not present a
  // cancelled job as a completed one) instead of finalizing.
  if (isCancelled && (await isCancelled())) {
    return markCancelled();
  }

  if (deps.onStep) await deps.onStep("finalizing");

  // Guard the final write with an atomic status check: never flip a row that
  // a concurrent cancel request already moved to cancelling/cancelled between
  // our read above and this write.
  const { data: finalized } = await supabase
    .from("reports")
    .update({
      pdf_storage_path: pdfStoragePath,
      html_storage_path: htmlStoragePath,
      // Deep PDF rendering depends on the external ai-ui-capture Playwright
      // service (ENABLE_AI_UI_CAPTURE + AI_UI_CAPTURE_URL). When it's not
      // configured or fails, renderReportPdf returns null and the user must be
      // told the download will be HTML, not silently handed an .html file
      // dressed up as a PDF download.
      pdf_degraded: !pdfStoragePath,
      white_label: !!gathered.branding,
      status: "ready",
      error_message: null,
      // Patch D: the authoritative terminal write is the only place allowed
      // to set progress to exactly 100 / clear current_step.
      current_step: null,
      progress_percent: 100,
    })
    .eq("id", reportId)
    .not("status", "in", "(cancelling,cancelled)")
    .select("id")
    .maybeSingle();

  if (!finalized) {
    // Lost the race to a cancel that landed between our checkpoint read and
    // this write — leave the row however the cancel route left it (cancelled)
    // rather than clobbering it back to ready.
    return "";
  }

  return pdfStoragePath || htmlStoragePath || "";
}

export async function saveIntelligenceReportArtifacts(
  supabase: SupabaseClient,
  projectId: string,
  reportId: string,
  organizationId: string,
  options?: { isCancelled?: () => Promise<boolean> }
): Promise<string> {
  return withJobContext({ reportId }, async () => {
    const { gatherIntelligenceReport } = await import("@/lib/engines/intelligence-report-builder");
    const { generateIntelligenceReportHTML } = await import("@/lib/engines/intelligence-report-template");
    const { generateReportNarrative } = await import("@/lib/engines/intelligence-report-narrative");
    const { renderReportPdf } = await import("@/lib/providers/ai-ui-capture");

    const { data: reportRow } = await supabase
      .from("reports")
      .select("sections")
      .eq("id", reportId)
      .single();
    const sections = (reportRow?.sections as IntelligenceReportSectionId[] | null) || undefined;

    // Patch D: one tracker spans the whole 11-step budget (8 gather steps +
    // narrative_generation/pdf_render/finalizing) so progress_percent climbs
    // smoothly across both phases instead of resetting between them.
    const tracker = createStepProgressTracker(supabase, "reports", reportId, DEEP_REPORT_ALL_STEPS);

    const gathered = await gatherIntelligenceReport(supabase, projectId, {
      sections,
      isCancelled: options?.isCancelled,
      onStepStart: tracker.onStepStart,
      onStepComplete: tracker.onStepComplete,
    });
    if (!gathered) throw new Error("No intelligence report data");

    // The gather fan-out (bounded-concurrency, cancellation-aware — see
    // runCancellableSteps in intelligence-report-builder.ts) stopped
    // scheduling new steps once cancellation was observed. Mirror
    // finalizeIntelligenceReport's own markCancelled() write here so a
    // cancel detected mid-gather is recorded immediately rather than
    // silently dropped (the caller only gets "" back either way).
    if (gathered.cancelled) {
      await supabase
        .from("reports")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          error_message: "Cancelled by user",
        })
        .eq("id", reportId);
      return "";
    }

    return finalizeIntelligenceReport(
      supabase,
      projectId,
      reportId,
      gathered,
      { generateReportNarrative, generateIntelligenceReportHTML, renderReportPdf, onStep: tracker.onStepStart },
      options?.isCancelled
    );
  });
}

/** Render HTML for a report row (standard or deep intelligence). */
export async function renderReportHtmlForView(
  supabase: SupabaseClient,
  projectId: string,
  reportType: "standard" | "deep" = "standard",
  sections?: IntelligenceReportSectionId[]
): Promise<string | null> {
  if (reportType === "deep") {
    const { gatherIntelligenceReport } = await import("@/lib/engines/intelligence-report-builder");
    const { generateIntelligenceReportHTML } = await import("@/lib/engines/intelligence-report-template");
    const { generateReportNarrative } = await import("@/lib/engines/intelligence-report-narrative");
    const gathered = await gatherIntelligenceReport(supabase, projectId, { sections });
    if (!gathered || gathered.cancelled) return null;
    const narrative = await generateReportNarrative(gathered.report, { useLlm: false });
    const gate = await applyReportQualityGate(supabase, gathered.report, {
      reportType: "deep_intelligence",
      projectId,
      orgId:
        "meta" in gathered.report && gathered.report.meta?.project
          ? gathered.report.meta.project.organization_id
          : null,
      renderPath: "render_report_html_for_view_deep",
      narrative,
      htmlView: true,
    });
    if (gate.blocked) return null;
    return generateIntelligenceReportHTML(
      gate.report as IntelligenceReport,
      gathered.branding,
      gate.narrative ?? narrative
    );
  }

  const gathered = await gatherReportData(supabase, projectId);
  if (!gathered) return null;
  const gate = await applyReportQualityGate(supabase, gathered.reportData, {
    reportType: "standard",
    projectId,
    orgId: gathered.reportData.project.organization_id,
    renderPath: "render_report_html_for_view_standard",
    htmlView: true,
  });
  if (gate.blocked) return null;
  return generateReportHTML(gate.report as ReportData, gathered.whiteLabel);
}
