/**
 * Canonical step lists for Patch D (real current_step/progress_percent).
 *
 * Kept in their own neutral module — not inside report-builder.ts or
 * intelligence-report-builder.ts — because those two files already have a
 * one-directional dependency (intelligence-report-builder.ts statically
 * imports gatherReportData from report-builder.ts; report-builder.ts only
 * ever reaches back via dynamic `import()` to avoid a cycle). A shared,
 * dependency-free constants module lets both sides (and scan-runner.ts)
 * import the same names without introducing a static circular import.
 */

/** The 8 bounded-concurrency fan-out steps run by runCancellableSteps() in
 * intelligence-report-builder.ts's gatherIntelligenceReport(). */
export const DEEP_REPORT_GATHER_STEPS = [
  "ai_visibility",
  "competitor_analysis",
  "backlink_analysis",
  "serp_analysis",
  "keyword_analysis",
  "technical_audit",
  "local_analysis",
  "analytics_attribution",
] as const;

/** The post-gather phase run by finalizeIntelligenceReport() in report-builder.ts. */
export const DEEP_REPORT_FINALIZE_STEPS = ["narrative_generation", "pdf_render", "finalizing"] as const;

/** Full step budget for a deep report, gather phase then finalize phase, in order. */
export const DEEP_REPORT_ALL_STEPS = [...DEEP_REPORT_GATHER_STEPS, ...DEEP_REPORT_FINALIZE_STEPS] as const;

/** Standard reports aren't broken into named sub-steps internally — the
 * Inngest generateReport function itself reports these three coarse phases. */
export const STANDARD_REPORT_STEPS = ["gathering", "rendering", "finalizing"] as const;

/**
 * Sequential phases of a visibility scan (scan-runner.ts's runProjectScan)
 * that ARE trackable in visibility_runs.current_step/progress_percent.
 *
 * Deliberately excludes the technical-audit/brand-extraction/prompt-
 * generation phases that run BEFORE the visibility_runs row is created
 * (the row's id doesn't exist yet, so there's nothing to write current_step
 * to) — inventing a step name for untracked work would be a fabricated
 * progress signal, which the project's honesty rules forbid. Those phases
 * are typically fast relative to visibility_scan (which runs the real
 * per-prompt AI-engine probes) so most of a user's actual wait happens
 * within the phases tracked here.
 */
export const SCAN_STEP_NAMES = ["visibility_scan", "citation_extraction", "scoring"] as const;
