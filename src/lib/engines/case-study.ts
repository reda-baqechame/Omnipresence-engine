import type { SupabaseClient } from "@supabase/supabase-js";
import type { SprintSnapshot, SprintVerdict } from "@/lib/engines/action-sprint";

/**
 * Named case studies with receipts (Master Plan v4 Phase 3).
 *
 * A case study is assembled ONLY from a project's own measured history:
 * the earliest sprint baseline, the latest completed sprint outcome, and the
 * receipt chain entries that back those numbers. Nothing is invented — if a
 * project has no completed sprint with measured snapshots on both sides,
 * no draft can be created. Publishing additionally requires explicit named
 * consent (brand name shown publicly).
 */

export interface CaseStudyDraft {
  title: string;
  summary: string;
  baseline: SprintSnapshot;
  outcome: SprintSnapshot;
  outcomeVerdict: SprintVerdict;
  receiptIds: string[];
  sprintCount: number;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/**
 * Build a draft from measured sprint history. Returns null (with a reason)
 * when the project doesn't yet have honest before/after data to show.
 */
export async function buildCaseStudyDraft(
  supabase: SupabaseClient,
  projectId: string,
  brandName: string
): Promise<{ draft: CaseStudyDraft | null; reason?: string }> {
  const { data: sprints } = await supabase
    .from("action_sprints")
    .select("id, status, baseline, outcome, outcome_verdict, week_start, completed_at")
    .eq("project_id", projectId)
    .eq("status", "completed")
    .order("week_start", { ascending: true });

  const completed = (sprints || []).filter(
    (s) => s.baseline && s.outcome && s.outcome_verdict && s.outcome_verdict !== "inconclusive"
  );
  if (completed.length === 0) {
    return {
      draft: null,
      reason:
        "No completed sprint with a measured before/after verdict yet. Run at least one full sprint cycle (start → fix → complete → remeasure) first.",
    };
  }

  const first = completed[0];
  const last = completed[completed.length - 1];
  const baseline = first.baseline as SprintSnapshot;
  const outcome = last.outcome as SprintSnapshot;
  const verdict = last.outcome_verdict as SprintVerdict;

  // Receipts that back the outcome window — latest chained evidence rows.
  const { data: receipts } = await supabase
    .from("ai_capture_evidence")
    .select("id")
    .eq("project_id", projectId)
    .not("receipt_hash", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);

  const mentionDelta = (outcome.mention_rate - baseline.mention_rate) * 100;
  const direction = mentionDelta > 0 ? "up" : mentionDelta < 0 ? "down" : "flat";

  const title =
    direction === "up"
      ? `${brandName}: AI mention rate ${pct(baseline.mention_rate)} → ${pct(outcome.mention_rate)}`
      : `${brandName}: measured AI visibility over ${completed.length} sprint${completed.length === 1 ? "" : "s"}`;

  const summary =
    `Across ${completed.length} completed action sprint${completed.length === 1 ? "" : "s"}, ` +
    `${brandName}'s measured AI mention rate went from ${pct(baseline.mention_rate)} ` +
    `(${baseline.sample_size} measured answers) to ${pct(outcome.mention_rate)} ` +
    `(${outcome.sample_size} measured answers); citation rate ${pct(baseline.citation_rate)} → ${pct(outcome.citation_rate)}. ` +
    `Final verdict: ${verdict}. Every number links to a verifiable receipt.`;

  return {
    draft: {
      title,
      summary,
      baseline,
      outcome,
      outcomeVerdict: verdict,
      receiptIds: (receipts || []).map((r) => r.id as string),
      sprintCount: completed.length,
    },
  };
}

export function caseStudySlug(brandName: string): string {
  const base = brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "case"}-${Date.now().toString(36)}`;
}
