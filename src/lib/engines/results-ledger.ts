import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultsLedgerEntry } from "@/types/database";

export async function recordLedgerAction(
  supabase: SupabaseClient,
  entry: Omit<ResultsLedgerEntry, "id" | "created_at" | "executed_at"> & { executed_at?: string }
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("results_ledger")
    .insert({
      ...entry,
      executed_at: entry.executed_at || new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return null;
  return data;
}

export async function getLedgerForProject(
  supabase: SupabaseClient,
  projectId: string,
  limit = 50
): Promise<ResultsLedgerEntry[]> {
  const { data } = await supabase
    .from("results_ledger")
    .select("*")
    .eq("project_id", projectId)
    .order("executed_at", { ascending: false })
    .limit(limit);

  return (data || []) as ResultsLedgerEntry[];
}

export function buildGuaranteeReport(
  entries: ResultsLedgerEntry[],
  scoreDelta: { before: number; after: number },
  trafficDelta: { before: number; after: number },
  citationDelta: { before: number; after: number }
): {
  summary: string;
  actionsCompleted: number;
  scoreChange: number;
  trafficChange: number;
  citationChange: number;
  reimbursementEligible: boolean;
  evidence: ResultsLedgerEntry[];
} {
  const completed = entries.filter((e) => e.status === "completed" || e.status === "verified");
  const scoreChange = scoreDelta.after - scoreDelta.before;
  const trafficChange = trafficDelta.after - trafficDelta.before;
  const citationChange = citationDelta.after - citationDelta.before;

  const reimbursementEligible =
    completed.length >= 5 && (scoreChange > 0 || trafficChange > 0 || citationChange > 0);

  return {
    summary: `${completed.length} actions executed. Score ${scoreChange >= 0 ? "+" : ""}${scoreChange.toFixed(1)}, traffic ${trafficChange >= 0 ? "+" : ""}${trafficChange}, citations ${citationChange >= 0 ? "+" : ""}${citationChange}.`,
    actionsCompleted: completed.length,
    scoreChange,
    trafficChange,
    citationChange,
    reimbursementEligible,
    evidence: completed,
  };
}

export async function recordScanBaseline(
  supabase: SupabaseClient,
  projectId: string,
  snapshot: Record<string, unknown>
): Promise<void> {
  await recordLedgerAction(supabase, {
    project_id: projectId,
    action_type: "scan_baseline",
    action_surface: "visibility",
    description: "OmniPresence scan baseline captured",
    baseline_snapshot: snapshot,
    outcome_snapshot: {},
    status: "completed",
  });
}
