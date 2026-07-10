/**
 * Resolve measured after-metrics for SearchOps verification from stored snapshots.
 * Never invents zeros; returns null when measurement is unavailable.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionTask } from "@/types/database";
import { findGscQuerySnapshotMetric } from "@/lib/engines/gsc-query-snapshots";
import { loadProjectVisibilitySnapshot } from "@/lib/engines/visibility-scope";

export type AfterMetricResolveResult =
  | { ok: true; afterMetric: Record<string, unknown> }
  | { ok: false; reason: string };

function extractQueryOrUrl(task: ExecutionTask): string | null {
  const evidence = (task.evidence || {}) as {
    evidence?: Array<{ value?: unknown }>;
  };
  const primary = (task.before_metric as { primary_evidence?: unknown } | null)?.primary_evidence;
  if (primary && typeof primary === "object") {
    const p = primary as Record<string, unknown>;
    if (typeof p.prompt === "string" && p.prompt.trim()) return p.prompt.trim();
    if (typeof p.url === "string" && p.url.trim()) return p.url.trim();
    if (typeof p.query === "string" && p.query.trim()) return p.query.trim();
  }
  const first = evidence.evidence?.[0]?.value;
  if (first && typeof first === "object") {
    const v = first as Record<string, unknown>;
    if (typeof v.prompt === "string" && v.prompt.trim()) return v.prompt.trim();
    if (typeof v.url === "string" && v.url.trim()) return v.url.trim();
    if (typeof v.query === "string" && v.query.trim()) return v.query.trim();
  }
  // Opportunity ids often encode the key: projectId:gsc:strike:query
  const sid = String(task.source_id || "");
  const parts = sid.split(":");
  if (parts.length >= 4 && (parts[1] === "gsc" || parts[1] === "serp")) {
    return parts.slice(3).join(":");
  }
  return null;
}

async function resolveGscAfter(
  supabase: SupabaseClient,
  task: ExecutionTask
): Promise<AfterMetricResolveResult> {
  const key = extractQueryOrUrl(task);
  if (!key) {
    return {
      ok: false,
      reason:
        "No query/URL key on task evidence — refresh GSC opportunities and re-create the task, or paste measured after JSON.",
    };
  }
  const metric = await findGscQuerySnapshotMetric(supabase, task.project_id, { key });
  if (!metric) {
    return {
      ok: false,
      reason: `No measured gsc_query_snapshots row for “${key}”. Run Refresh GSC opportunities first, then auto-verify.`,
    };
  }
  return { ok: true, afterMetric: metric };
}

async function resolveAiVisibilityAfter(
  supabase: SupabaseClient,
  task: ExecutionTask,
  brandName: string,
  competitors: string[]
): Promise<AfterMetricResolveResult> {
  const snap = await loadProjectVisibilitySnapshot(supabase, task.project_id, brandName, competitors);
  if (!snap.ratesReliable || snap.metrics.mentionRate == null) {
    return {
      ok: false,
      reason:
        snap.reliabilityNote ||
        "AI visibility after-metric unavailable — insufficient grounded probes (not zero).",
    };
  }
  return {
    ok: true,
    afterMetric: {
      status: "measured",
      source: "visibility_results",
      mention_rate: snap.metrics.mentionRate,
      citation_rate: snap.metrics.citationRate ?? null,
      sample_size: snap.groundedResults.length,
      captured_at: new Date().toISOString(),
    },
  };
}

async function resolveAuthorityAfter(
  supabase: SupabaseClient,
  task: ExecutionTask
): Promise<AfterMetricResolveResult> {
  const { data } = await supabase
    .from("backlink_graph_snapshots")
    .select("referring_domains, total_links, new_count, lost_count, data_source, created_at")
    .eq("project_id", task.project_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || data.referring_domains == null) {
    return {
      ok: false,
      reason:
        "No measured backlink_graph_snapshots referring_domains — rebuild webgraph; unavailable ≠ zero.",
    };
  }
  if (data.data_source === "unavailable" || data.data_source === "simulated") {
    return {
      ok: false,
      reason: `Latest webgraph snapshot data_source is ${data.data_source} — cannot verify as measured.`,
    };
  }
  return {
    ok: true,
    afterMetric: {
      status: "measured",
      source: "backlink_graph_snapshots",
      referring_domains: data.referring_domains,
      total_links: data.total_links,
      new_count: data.new_count,
      lost_count: data.lost_count,
      captured_at: data.created_at || new Date().toISOString(),
    },
  };
}

async function resolveTechnicalAfter(
  supabase: SupabaseClient,
  task: ExecutionTask
): Promise<AfterMetricResolveResult> {
  const { data } = await supabase
    .from("cwv_history")
    .select("collected_on, lcp_ms, inp_ms, cls, data_source")
    .eq("project_id", task.project_id)
    .order("collected_on", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || (data.lcp_ms == null && data.inp_ms == null && data.cls == null)) {
    return {
      ok: false,
      reason: "No measured cwv_history row — re-run CWV collection before auto-verify.",
    };
  }
  if (data.data_source !== "measured") {
    return {
      ok: false,
      reason: `Latest CWV data_source is ${data.data_source || "unknown"} — verification requires measured field data.`,
    };
  }
  return {
    ok: true,
    afterMetric: {
      status: "measured",
      source: "cwv_history",
      lcp_ms: data.lcp_ms,
      inp_ms: data.inp_ms,
      cls: data.cls,
      collected_on: data.collected_on,
      captured_at: new Date().toISOString(),
    },
  };
}

/**
 * Auto-resolve after metric from stored snapshots for a SearchOps task.
 * Category-aware; never invents success metrics.
 */
export async function resolveAfterMetricFromSnapshots(
  supabase: SupabaseClient,
  opts: {
    task: ExecutionTask;
    brandName?: string | null;
    competitors?: string[] | null;
  }
): Promise<AfterMetricResolveResult> {
  const category = String(opts.task.category || "").toLowerCase();

  if (category === "gsc" || category === "serp" || category === "content") {
    // Content decay / GSC CTR / striking distance → GSC query snapshots when present
    const gsc = await resolveGscAfter(supabase, opts.task);
    if (gsc.ok) return gsc;
    if (category === "gsc" || category === "serp") return gsc;
    // content may fall through to other sources only if GSC key missing — still fail honestly
    return gsc;
  }

  if (category === "ai_visibility") {
    return resolveAiVisibilityAfter(
      supabase,
      opts.task,
      opts.brandName || "",
      opts.competitors || []
    );
  }

  if (category === "authority") {
    return resolveAuthorityAfter(supabase, opts.task);
  }

  if (category === "technical") {
    return resolveTechnicalAfter(supabase, opts.task);
  }

  // Generic: try GSC key, then AI rates, then authority
  const gsc = await resolveGscAfter(supabase, opts.task);
  if (gsc.ok) return gsc;

  return {
    ok: false,
    reason:
      opts.task.category
        ? `No auto-verify snapshot resolver for category “${opts.task.category}”. Paste measured after_metric JSON or mark verification unavailable.`
        : "After metric unavailable from snapshots — paste measured JSON or mark verification unavailable.",
  };
}
