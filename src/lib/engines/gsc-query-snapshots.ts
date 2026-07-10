/**
 * Persist / load first-party GSC query & page rows from explicit refresh.
 * SSR and auto-verify read these snapshots — never call Google on page load.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GscInsights } from "@/lib/engines/gsc-queries";

export type GscQuerySnapshotRow = {
  dimension: "query" | "page";
  key: string;
  range_start: string;
  range_end: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
  data_source: string;
  captured_on: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Upsert measured query/page rows + roll-up totals into gsc_snapshots.
 * Idempotent per (project, day, dimension, key, range).
 */
export async function persistGscInsightsSnapshots(
  supabase: SupabaseClient,
  projectId: string,
  insights: GscInsights
): Promise<{ queryRows: number; pageRows: number; totalsWritten: boolean }> {
  const capturedOn = today();
  const rangeStart = insights.range.current.start;
  const rangeEnd = insights.range.current.end;

  const queryRows = [
    ...insights.topQueries,
    ...insights.strikingDistance,
    ...insights.lowCtr,
  ];
  const seenQ = new Set<string>();
  const queryPayload = [];
  for (const q of queryRows) {
    const key = String(q.query || "").trim();
    if (!key || seenQ.has(key.toLowerCase())) continue;
    seenQ.add(key.toLowerCase());
    queryPayload.push({
      project_id: projectId,
      captured_on: capturedOn,
      dimension: "query" as const,
      key,
      range_start: rangeStart,
      range_end: rangeEnd,
      clicks: q.clicks ?? null,
      impressions: q.impressions ?? null,
      ctr: q.ctr ?? null,
      position: q.position ?? null,
      data_source: "measured",
    });
  }

  const seenP = new Set<string>();
  const pagePayload = [];
  for (const p of [...insights.topPages, ...insights.decay.map((d) => ({
    url: d.url,
    clicks: d.currClicks,
    impressions: d.currImpressions,
    ctr: d.currImpressions ? d.currClicks / d.currImpressions : 0,
    position: null as number | null,
  }))]) {
    const key = String(p.url || "").trim();
    if (!key || seenP.has(key.toLowerCase())) continue;
    seenP.add(key.toLowerCase());
    pagePayload.push({
      project_id: projectId,
      captured_on: capturedOn,
      dimension: "page" as const,
      key,
      range_start: rangeStart,
      range_end: rangeEnd,
      clicks: p.clicks ?? null,
      impressions: p.impressions ?? null,
      ctr: p.ctr ?? null,
      position: p.position ?? null,
      data_source: "measured",
    });
  }

  const batch = [...queryPayload, ...pagePayload];
  if (batch.length) {
    // Chunk to avoid payload limits
    for (let i = 0; i < batch.length; i += 200) {
      const chunk = batch.slice(i, i + 200);
      const { error } = await supabase.from("gsc_query_snapshots").upsert(chunk, {
        onConflict: "project_id,captured_on,dimension,key,range_start,range_end",
      });
      if (error) throw new Error(`gsc_query_snapshots upsert failed: ${error.message}`);
    }
  }

  const { error: totalsErr } = await supabase.from("gsc_snapshots").upsert(
    {
      project_id: projectId,
      captured_on: capturedOn,
      clicks: insights.totals.clicks,
      impressions: insights.totals.impressions,
      ctr: insights.totals.ctr,
      avg_position: insights.totals.avgPosition,
      data_source: "measured",
    },
    { onConflict: "project_id,captured_on" }
  );
  if (totalsErr) throw new Error(`gsc_snapshots upsert failed: ${totalsErr.message}`);

  return {
    queryRows: queryPayload.length,
    pageRows: pagePayload.length,
    totalsWritten: true,
  };
}

/** Latest captured_on for a project, or null. */
export async function loadLatestGscQuerySnapshotDay(
  supabase: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("gsc_query_snapshots")
    .select("captured_on")
    .eq("project_id", projectId)
    .order("captured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.captured_on ?? null;
}

export async function loadGscQuerySnapshotRows(
  supabase: SupabaseClient,
  projectId: string,
  opts: { capturedOn?: string | null; dimension?: "query" | "page"; limit?: number } = {}
): Promise<GscQuerySnapshotRow[]> {
  let capturedOn = opts.capturedOn;
  if (!capturedOn) {
    capturedOn = await loadLatestGscQuerySnapshotDay(supabase, projectId);
  }
  if (!capturedOn) return [];

  let q = supabase
    .from("gsc_query_snapshots")
    .select(
      "dimension, key, range_start, range_end, clicks, impressions, ctr, position, data_source, captured_on"
    )
    .eq("project_id", projectId)
    .eq("captured_on", capturedOn)
    .order("impressions", { ascending: false })
    .limit(opts.limit ?? 200);

  if (opts.dimension) q = q.eq("dimension", opts.dimension);

  const { data, error } = await q;
  if (error || !data) return [];
  return data as GscQuerySnapshotRow[];
}

/**
 * Look up a single measured query/page row for auto-verify after metrics.
 */
export async function findGscQuerySnapshotMetric(
  supabase: SupabaseClient,
  projectId: string,
  opts: { key: string; dimension?: "query" | "page" }
): Promise<Record<string, unknown> | null> {
  const key = opts.key.trim();
  if (!key) return null;
  const dimension = opts.dimension ?? (key.startsWith("http") ? "page" : "query");

  const { data } = await supabase
    .from("gsc_query_snapshots")
    .select("key, dimension, clicks, impressions, ctr, position, captured_on, data_source, range_start, range_end")
    .eq("project_id", projectId)
    .eq("dimension", dimension)
    .eq("key", key)
    .order("captured_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || data.impressions == null) return null;
  return {
    status: "measured",
    source: "gsc_query_snapshots",
    dimension: data.dimension,
    key: data.key,
    clicks: data.clicks,
    impressions: data.impressions,
    ctr: data.ctr,
    position: data.position,
    captured_on: data.captured_on,
    range_start: data.range_start,
    range_end: data.range_end,
    captured_at: new Date().toISOString(),
  };
}
