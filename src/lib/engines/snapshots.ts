/**
 * Daily snapshots + data-quality scoring (Phase 23 / manifest v24, Wave E).
 *
 * Persists point-in-time GSC / GBP / AI-visibility values so trend lines are
 * real measured history, and computes a per-project data-quality score = how
 * much of the platform is running on genuinely measured signals (vs
 * unavailable). All upserts are idempotent per (project, day). When a source
 * isn't connected we simply skip it — we never write a fabricated snapshot.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function tableHasRows(supabase: SupabaseClient, table: string, projectId: string): Promise<boolean> {
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  return (count ?? 0) > 0;
}

export async function snapshotAiVisibility(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ written: boolean; mentionRate: number | null; citationRate: number | null }> {
  const { data } = await supabase
    .from("ai_probe_traces")
    .select("brand_mentioned, brand_cited, grounding_mode")
    .eq("project_id", projectId)
    .order("checked_at", { ascending: false })
    .limit(300);

  const rows = data || [];
  if (rows.length === 0) return { written: false, mentionRate: null, citationRate: null };

  const mention = rows.filter((r) => r.brand_mentioned).length;
  const cited = rows.filter((r) => r.brand_cited).length;
  const grounded = rows.filter((r) => r.grounding_mode === "grounded" || r.grounding_mode === "ui_capture").length;
  const mentionRate = Math.round((mention / rows.length) * 1000) / 1000;
  const citationRate = Math.round((cited / rows.length) * 1000) / 1000;
  const groundedRate = Math.round((grounded / rows.length) * 1000) / 1000;

  await supabase.from("ai_visibility_snapshots").upsert(
    {
      project_id: projectId,
      captured_on: today(),
      probe_count: rows.length,
      mention_rate: mentionRate,
      citation_rate: citationRate,
      grounded_rate: groundedRate,
      data_source: "measured",
    },
    { onConflict: "project_id,captured_on" }
  );
  return { written: true, mentionRate, citationRate };
}

export async function snapshotGsc(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ written: boolean }> {
  const { data } = await supabase
    .from("attribution_metrics")
    .select("search_clicks, organic_traffic, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { written: false };

  await supabase.from("gsc_snapshots").upsert(
    {
      project_id: projectId,
      captured_on: today(),
      clicks: data.search_clicks ?? data.organic_traffic ?? null,
      impressions: null,
      ctr: null,
      avg_position: null,
      data_source: "measured",
    },
    { onConflict: "project_id,captured_on" }
  );
  return { written: true };
}

export async function snapshotGbp(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ written: boolean }> {
  const { data } = await supabase
    .from("local_grid_scans")
    .select("avg_rank, found_cells, total_cells, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { written: false };

  const coverage = data.total_cells ? Math.round((data.found_cells / data.total_cells) * 1000) / 1000 : null;
  await supabase.from("gbp_snapshots").upsert(
    {
      project_id: projectId,
      captured_on: today(),
      avg_rank: data.avg_rank ?? null,
      found_cells: data.found_cells ?? null,
      total_cells: data.total_cells ?? null,
      coverage,
      data_source: "measured",
    },
    { onConflict: "project_id,captured_on" }
  );
  return { written: true };
}

/**
 * Per-project data-quality score: the share of core signals that are backed by
 * genuinely measured data. This is the honesty meter — a low score tells the
 * operator (and the claims harness in Wave F) which claims aren't yet backed.
 */
export async function computeDataQuality(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ score: number; measured: number; total: number; breakdown: Record<string, boolean> }> {
  const signals: Array<{ key: string; table: string }> = [
    { key: "ai_visibility", table: "ai_probe_traces" },
    { key: "citations", table: "citation_sources" },
    { key: "technical", table: "technical_findings" },
    { key: "backlinks", table: "backlink_snapshots" },
    { key: "gsc", table: "attribution_metrics" },
    { key: "local_gbp", table: "local_grid_scans" },
    { key: "rankings", table: "rank_snapshots" },
    { key: "source_graph", table: "source_domains" },
  ];

  const breakdown: Record<string, boolean> = {};
  let measured = 0;
  for (const s of signals) {
    const has = await tableHasRows(supabase, s.table, projectId).catch(() => false);
    breakdown[s.key] = has;
    if (has) measured += 1;
  }
  const total = signals.length;
  const score = Math.round((measured / total) * 100);

  await supabase.from("data_quality_scores").upsert(
    {
      project_id: projectId,
      captured_on: today(),
      quality_score: score,
      measured_signals: measured,
      total_signals: total,
      breakdown,
      data_source: "measured",
    },
    { onConflict: "project_id,captured_on" }
  );

  return { score, measured, total, breakdown };
}

export interface SnapshotSummary {
  projectId: string;
  aiVisibility: boolean;
  gsc: boolean;
  gbp: boolean;
  qualityScore: number;
}

/** Orchestrate all snapshots + the data-quality score for one project. */
export async function runProjectSnapshots(
  supabase: SupabaseClient,
  projectId: string
): Promise<SnapshotSummary> {
  const [ai, gsc, gbp, quality] = await Promise.all([
    snapshotAiVisibility(supabase, projectId),
    snapshotGsc(supabase, projectId),
    snapshotGbp(supabase, projectId),
    computeDataQuality(supabase, projectId),
  ]);
  return {
    projectId,
    aiVisibility: ai.written,
    gsc: gsc.written,
    gbp: gbp.written,
    qualityScore: quality.score,
  };
}
