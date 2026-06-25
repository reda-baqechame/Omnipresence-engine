import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResultsLedgerEntry } from "@/types/database";
import { buildGuaranteeReportFromLedger } from "@/lib/engines/guarantee";

export { buildGuaranteeReportFromLedger as buildGuaranteeReport };

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

export function calculatePeriodCitationDelta(
  currentCount: number,
  previousCount: number
): { before: number; after: number; change: number; changePercent: number } {
  return {
    before: previousCount,
    after: currentCount,
    change: currentCount - previousCount,
    changePercent: previousCount > 0 ? ((currentCount - previousCount) / previousCount) * 100 : currentCount > 0 ? 100 : 0,
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
