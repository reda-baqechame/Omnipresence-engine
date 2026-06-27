import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Crawl/finding diff (Phase 9). Instead of treating each audit as a fresh wipe,
 * compute what changed since the last scan: NEW (appeared), FIXED (disappeared),
 * and REGRESSED (a previously-fixed issue that came back). Persisted as a
 * finding_snapshot so the technical view can show movement and tie to tasks.
 */

export interface FindingDiff {
  total: number;
  newTitles: string[];
  fixedTitles: string[];
  regressedTitles: string[];
}

function norm(t: string): string {
  return t.trim().toLowerCase();
}

export async function computeAndRecordFindingDiff(
  supabase: SupabaseClient,
  projectId: string,
  newFindingTitles: string[]
): Promise<FindingDiff> {
  // Previous live findings (about to be replaced).
  const { data: prevFindings } = await supabase
    .from("technical_findings")
    .select("title")
    .eq("project_id", projectId);
  const prevTitles = new Set((prevFindings || []).map((f) => norm(f.title)));

  const currentNorm = new Map(newFindingTitles.map((t) => [norm(t), t]));
  const currentSet = new Set(currentNorm.keys());

  const newTitles: string[] = [];
  for (const [n, original] of currentNorm) {
    if (!prevTitles.has(n)) newTitles.push(original);
  }

  const fixedTitles: string[] = [];
  for (const f of prevFindings || []) {
    if (!currentSet.has(norm(f.title))) fixedTitles.push(f.title);
  }

  // Regressed = something now present that a PRIOR snapshot had marked fixed.
  const { data: priorSnaps } = await supabase
    .from("finding_snapshots")
    .select("fixed_titles")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);
  const everFixed = new Set<string>();
  for (const s of priorSnaps || []) {
    for (const t of (s.fixed_titles || []) as string[]) everFixed.add(norm(t));
  }
  const regressedTitles = newTitles.filter((t) => everFixed.has(norm(t)));

  await supabase.from("finding_snapshots").insert({
    project_id: projectId,
    total: newFindingTitles.length,
    new_count: newTitles.length,
    fixed_count: fixedTitles.length,
    regressed_count: regressedTitles.length,
    new_titles: newTitles,
    fixed_titles: fixedTitles,
    regressed_titles: regressedTitles,
  });

  return { total: newFindingTitles.length, newTitles, fixedTitles, regressedTitles };
}
