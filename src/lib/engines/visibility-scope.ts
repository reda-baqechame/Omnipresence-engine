import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisibilityResult } from "@/types/database";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { calculateShareOfVoice } from "@/lib/engines/share-of-voice";

export interface VisibilityRunRef {
  id: string;
  status: string;
  completed_at?: string | null;
  created_at: string;
  error_message?: string | null;
  prompt_count?: number | null;
  engines?: string[] | null;
}

const MIN_GROUNDED_PROBES = 10;
const MIN_GROUNDED_RATE = 0.25;

function dataQuality(r: Pick<VisibilityResult, "data_source" | "raw_response">) {
  return r.data_source ?? (r.raw_response?.data_source as string | undefined);
}

/** Only SERP-grounded probes count toward headline rates — not model_knowledge. */
export function groundedVisibilityResults(results: VisibilityResult[]): VisibilityResult[] {
  return results.filter((r) => dataQuality(r) === "measured");
}

export function scopeVisibilityToLatestRun(
  results: VisibilityResult[],
  runs: VisibilityRunRef[]
): VisibilityResult[] {
  if (!runs.length) return results;

  const sorted = [...runs].sort(
    (a, b) =>
      new Date(b.completed_at || b.created_at).getTime() -
      new Date(a.completed_at || a.created_at).getTime()
  );
  // Completed runs first; fall back to the newest run that actually stored probes.
  const ordered = [
    ...sorted.filter((r) => r.status === "completed"),
    ...sorted.filter((r) => r.status !== "completed"),
  ];
  for (const run of ordered) {
    const scoped = results.filter((r) => r.run_id === run.id);
    if (scoped.length > 0) return scoped;
  }
  return results;
}

export interface HonestVisibilitySnapshot {
  scopedResults: VisibilityResult[];
  groundedResults: VisibilityResult[];
  metrics: ReturnType<typeof calculateVisibilityMetrics>;
  sov: ReturnType<typeof calculateShareOfVoice>;
  attempted: number;
  groundedCount: number;
  modelKnowledgeCount: number;
  unavailableCount: number;
  groundedRate: number;
  ratesReliable: boolean;
  reliabilityNote: string | null;
  latestRun: VisibilityRunRef | null;
}

export function buildHonestVisibilitySnapshot(
  results: VisibilityResult[],
  brandName: string,
  competitors: string[],
  runs: VisibilityRunRef[] = []
): HonestVisibilitySnapshot {
  const scopedResults = scopeVisibilityToLatestRun(results, runs);
  const groundedResults = groundedVisibilityResults(scopedResults);
  const attempted = scopedResults.length;
  const groundedCount = groundedResults.length;
  const modelKnowledgeCount = scopedResults.filter((r) => dataQuality(r) === "model_knowledge").length;
  const unavailableCount = scopedResults.filter((r) => dataQuality(r) === "unavailable").length;
  const groundedRate = attempted > 0 ? groundedCount / attempted : 0;

  const metrics = calculateVisibilityMetrics(groundedResults);
  const sov = calculateShareOfVoice(groundedResults, brandName, competitors);

  const ratesReliable =
    groundedCount >= MIN_GROUNDED_PROBES && groundedRate >= MIN_GROUNDED_RATE;

  let reliabilityNote: string | null = null;
  if (attempted === 0) {
    reliabilityNote = "No visibility probes yet. Run a scan to measure AI and search answers.";
  } else if (groundedCount === 0) {
    reliabilityNote =
      "No grounded measurements in the latest scan — connect SERP + LLM providers and re-scan.";
  } else if (!ratesReliable) {
    reliabilityNote = `Only ${groundedCount} of ${attempted} probes returned grounded data (${Math.round(groundedRate * 100)}%). Headline rates are hidden until coverage improves.`;
  }

  const latestRun =
    runs.find((r) => scopedResults.some((x) => x.run_id === r.id)) ?? runs[0] ?? null;

  return {
    scopedResults,
    groundedResults,
    metrics,
    sov,
    attempted,
    groundedCount,
    modelKnowledgeCount,
    unavailableCount,
    groundedRate,
    ratesReliable,
    reliabilityNote,
    latestRun,
  };
}

export function formatRate(value: number, reliable: boolean): string {
  if (!reliable) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Single fetch+scope entry point for server pages and API routes. */
export async function loadProjectVisibilitySnapshot(
  supabase: SupabaseClient,
  projectId: string,
  brandName: string,
  competitors: string[]
): Promise<HonestVisibilitySnapshot & { allResults: VisibilityResult[]; runs: VisibilityRunRef[] }> {
  const [{ data: visibility }, { data: runs }] = await Promise.all([
    supabase
      .from("visibility_results")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    supabase
      .from("visibility_runs")
      .select("id, status, completed_at, created_at, error_message, prompt_count, engines")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const allResults = (visibility || []) as VisibilityResult[];
  const runList = (runs || []) as VisibilityRunRef[];
  const snapshot = buildHonestVisibilitySnapshot(allResults, brandName, competitors, runList);

  return { ...snapshot, allResults, runs: runList };
}
