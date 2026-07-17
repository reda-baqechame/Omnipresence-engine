import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pageOpportunities,
  missingCitationSources,
} from "@/lib/engines/visibility-insights";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import type { TechnicalFinding, VisibilityResult } from "@/types/database";

/**
 * Weekly Action Sprints (Master Plan v4 Phase 2, Trakkr pattern).
 *
 * Each sprint is a small, prioritized batch of fixes drawn ONLY from the
 * project's own measured gaps — the same three categories as the Gap Analysis
 * page (technical AI readiness, answer-ready content, source/citation
 * opportunities). A visibility baseline is captured when the sprint starts,
 * and after the next remeasure the sprint gets an honest verdict:
 * increased / unchanged / declined / inconclusive — never a success theater.
 */

export type SprintItemCategory = "technical" | "content" | "sources";

export interface SprintItem {
  title: string;
  category: SprintItemCategory;
  /** Which measured signal produced this item. */
  source: string;
  /** Copy-paste-ready fix when available. */
  fix: string | null;
  detail: string | null;
  done: boolean;
}

export interface SprintSnapshot {
  mention_rate: number;
  citation_rate: number;
  sample_size: number;
  captured_at: string;
}

export type SprintVerdict = "verified" | "increased" | "unchanged" | "declined" | "inconclusive";

/** Minimum measured probes on BOTH sides before a directional verdict is honest. */
export const SPRINT_MIN_SAMPLE = 30;
/** Percentage-point movement below which we call the result "unchanged". */
export const SPRINT_CHANGE_THRESHOLD_PP = 3;

const MAX_ITEMS_PER_SPRINT = 7;

export async function buildSprintItems(
  supabase: SupabaseClient,
  projectId: string,
  brandDomain: string
): Promise<SprintItem[]> {
  const [{ data: findingsData }, { data: resultsData }, { data: authorityData }] = await Promise.all([
    supabase
      .from("technical_findings")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_resolved", false)
      .limit(100),
    supabase.from("visibility_results").select("*").eq("project_id", projectId).limit(1000),
    supabase
      .from("authority_opportunities")
      .select("type, target_site, pitch_angle, estimated_impact")
      .eq("project_id", projectId)
      .order("estimated_impact", { ascending: false })
      .limit(5),
  ]);

  const findings = (findingsData || []) as TechnicalFinding[];
  const results = (resultsData || []) as VisibilityResult[];
  const items: SprintItem[] = [];

  // 1) Technical AI readiness: worst open findings first (critical/high only —
  //    a weekly sprint should never be filled with low-severity noise).
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const technical = findings
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
    .slice(0, 3);
  for (const f of technical) {
    items.push({
      title: f.title,
      category: "technical",
      source: `technical_finding:${f.category}`,
      fix: f.fix_recommendation || null,
      detail: f.description || null,
      done: false,
    });
  }

  // 2) Answer-ready content: prompts where the brand is absent from measured
  //    answers while competitors win (the highest-leverage content work).
  const pages = pageOpportunities(results, 4);
  for (const p of pages.create.slice(0, 2)) {
    items.push({
      title: `Create an answer-ready page for "${p.prompt}"`,
      category: "content",
      source: "visibility:absent_prompt",
      fix: null,
      detail: `Brand absent in measured answers on ${p.engines.join(", ")}${p.competitors.length ? `; currently won by ${p.competitors.slice(0, 3).join(", ")}` : ""}.`,
      done: false,
    });
  }
  for (const p of pages.update.slice(0, 1)) {
    items.push({
      title: `Update the page answering "${p.prompt}" to earn citations`,
      category: "content",
      source: "visibility:mentioned_not_cited",
      fix: null,
      detail: p.reason,
      done: false,
    });
  }

  // 3) Source/citation opportunities: domains AI engines already cite where the
  //    brand is missing, then authority targets with a concrete pitch.
  const sources = missingCitationSources(results, brandDomain, 2);
  for (const s of sources) {
    items.push({
      title: `Earn presence on ${s.domain}`,
      category: "sources",
      source: "visibility:missing_citation_source",
      fix: null,
      detail: `Cited in ${s.count} measured answer${s.count === 1 ? "" : "s"} where you weren't${s.competitors.length ? ` — alongside ${s.competitors.slice(0, 3).join(", ")}` : ""}.`,
      done: false,
    });
  }
  const authority = (authorityData || []) as Array<{
    type: string;
    target_site: string;
    pitch_angle: string | null;
  }>;
  for (const o of authority.slice(0, Math.max(0, MAX_ITEMS_PER_SPRINT - items.length))) {
    if (items.length >= MAX_ITEMS_PER_SPRINT) break;
    items.push({
      title: `Pitch ${o.target_site}`,
      category: "sources",
      source: `authority:${o.type}`,
      fix: null,
      detail: o.pitch_angle,
      done: false,
    });
  }

  return items.slice(0, MAX_ITEMS_PER_SPRINT);
}

/** Current measured visibility snapshot for baseline/outcome comparison. */
export async function captureSprintSnapshot(
  supabase: SupabaseClient,
  projectId: string
): Promise<SprintSnapshot> {
  const { data } = await supabase
    .from("visibility_results")
    .select("brand_mentioned, brand_cited, competitor_mentions, raw_response, data_source, recommendation_strength, answer_position, confidence")
    .eq("project_id", projectId)
    .limit(1000);
  const metrics = calculateVisibilityMetrics((data || []) as VisibilityResult[]);
  return {
    mention_rate: metrics.mentionRate,
    citation_rate: metrics.citationRate,
    sample_size: metrics.sampleSize,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Honest verdict from baseline vs outcome. `inconclusive` when either side
 * lacks a defensible sample — a thin sample must never produce a directional
 * claim a client could be billed on.
 */
export function classifySprintOutcome(
  baseline: SprintSnapshot | null,
  outcome: SprintSnapshot | null
): SprintVerdict {
  if (!baseline || !outcome) return "inconclusive";
  if (baseline.sample_size < SPRINT_MIN_SAMPLE || outcome.sample_size < SPRINT_MIN_SAMPLE) {
    return "inconclusive";
  }
  const mentionDeltaPp = (outcome.mention_rate - baseline.mention_rate) * 100;
  const citationDeltaPp = (outcome.citation_rate - baseline.citation_rate) * 100;
  // Citation movement outranks mention movement (it's the harder, more
  // valuable signal); either crossing the threshold decides the verdict.
  const primary = Math.abs(citationDeltaPp) >= SPRINT_CHANGE_THRESHOLD_PP ? citationDeltaPp
    : Math.abs(mentionDeltaPp) >= SPRINT_CHANGE_THRESHOLD_PP ? mentionDeltaPp
    : 0;
  if (primary > 0) return "increased";
  if (primary < 0) return "declined";
  return "unchanged";
}

/**
 * Finalize sprints left in "measuring" after a fresh scan wrote new
 * visibility rows — this is the "panel rerun -> before/after" close of the
 * loop. Called from the scan runner so the outcome snapshot is guaranteed to
 * be post-remeasure data, never the stale baseline re-read.
 */
export async function finalizeMeasuringSprints(
  supabase: SupabaseClient,
  projectId: string
): Promise<number> {
  const { data: measuring } = await supabase
    .from("action_sprints")
    .select("id, baseline")
    .eq("project_id", projectId)
    .eq("status", "measuring");
  if (!measuring || measuring.length === 0) return 0;

  const outcome = await captureSprintSnapshot(supabase, projectId);
  for (const sprint of measuring) {
    await supabase
      .from("action_sprints")
      .update({
        status: "completed",
        outcome,
        outcome_verdict: classifySprintOutcome(sprint.baseline as SprintSnapshot | null, outcome),
        completed_at: new Date().toISOString(),
      })
      .eq("id", sprint.id)
      .eq("status", "measuring");
  }
  return measuring.length;
}

/** Monday (UTC) of the week containing `date` — sprint identity key. */
export function sprintWeekStart(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Weekly upkeep for one project (idempotent):
 * 1. Close out any sprint left in "active"/"measuring" from a previous week —
 *    capture the outcome snapshot and classify it honestly.
 * 2. Propose this week's sprint when none exists and there is measured data.
 * Returns what happened for observability.
 */
export async function runWeeklySprintUpkeep(
  supabase: SupabaseClient,
  project: { id: string; organization_id: string; domain: string }
): Promise<{ closed: number; proposed: boolean }> {
  const weekStart = sprintWeekStart();
  let closed = 0;

  const { data: openSprints } = await supabase
    .from("action_sprints")
    .select("id, baseline, week_start, status")
    .eq("project_id", project.id)
    .in("status", ["active", "measuring"])
    .lt("week_start", weekStart);

  for (const sprint of openSprints || []) {
    const outcome = await captureSprintSnapshot(supabase, project.id);
    const verdict = classifySprintOutcome(sprint.baseline as SprintSnapshot | null, outcome);
    await supabase
      .from("action_sprints")
      .update({
        status: "completed",
        outcome,
        outcome_verdict: verdict,
        completed_at: new Date().toISOString(),
      })
      .eq("id", sprint.id);
    closed++;
  }

  const { data: existing } = await supabase
    .from("action_sprints")
    .select("id")
    .eq("project_id", project.id)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing) return { closed, proposed: false };

  const items = await buildSprintItems(supabase, project.id, project.domain);
  if (items.length === 0) return { closed, proposed: false };

  await supabase.from("action_sprints").insert({
    project_id: project.id,
    organization_id: project.organization_id,
    week_start: weekStart,
    status: "proposed",
    items,
  });
  return { closed, proposed: true };
}
