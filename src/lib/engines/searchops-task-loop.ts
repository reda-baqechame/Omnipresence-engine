/**
 * SearchOps opportunity → task → verify → proof helpers (pure + insert helpers).
 * Uses existing execution_tasks + results_ledger — no second proof system.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutionTask, ResultsLedgerEntry } from "@/types/database";
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import { opportunityToTaskDraft } from "@/lib/engines/searchops-opportunity-engine";
import { recordLedgerAction } from "@/lib/engines/results-ledger";

export type VerifyOutcome =
  | { ok: true; status: "verified"; task: ExecutionTask; ledgerId: string | null }
  | { ok: true; status: "verification_unavailable"; task: ExecutionTask; reason: string }
  | { ok: false; error: string };

/**
 * Create or upsert an execution task from a SearchOps opportunity.
 * Dedupes on (project_id, source_module, source_id).
 */
export async function createTaskFromOpportunity(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    organizationId: string;
    opportunity: SearchOpsOpportunity;
  }
): Promise<{ task: ExecutionTask; created: boolean } | { error: string }> {
  const draft = opportunityToTaskDraft(opts.opportunity);

  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("*")
    .eq("project_id", opts.projectId)
    .eq("source_module", draft.source_module)
    .eq("source_id", draft.source_id)
    .maybeSingle();

  if (existing) {
    return { task: existing as ExecutionTask, created: false };
  }

  const { data: task, error } = await supabase
    .from("execution_tasks")
    .insert({
      project_id: opts.projectId,
      organization_id: opts.organizationId,
      title: draft.title,
      description: draft.description,
      source_module: draft.source_module,
      source_id: draft.source_id,
      category: draft.category,
      priority: draft.priority,
      impact: draft.impact,
      effort: draft.effort,
      status: "todo",
      evidence: draft.evidence,
      before_metric: draft.before_metric,
    })
    .select("*")
    .single();

  if (error || !task) {
    return { error: error?.message || "Failed to create task" };
  }
  return { task: task as ExecutionTask, created: true };
}

/**
 * Mark task ready for verification (post-work, awaiting before/after proof).
 * Maps to status "done" with completed_at — not verified until metrics compare.
 */
export async function markTaskReadyForVerification(
  supabase: SupabaseClient,
  taskId: string
): Promise<{ task: ExecutionTask } | { error: string }> {
  const { data: task, error } = await supabase
    .from("execution_tasks")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error || !task) return { error: error?.message || "Failed to update task" };
  return { task: task as ExecutionTask };
}

function isMeasuredMetric(m: Record<string, unknown> | null | undefined): boolean {
  if (!m || typeof m !== "object") return false;
  const status = String((m as { status?: unknown }).status || "").toLowerCase();
  if (status === "unavailable" || status === "simulated") return false;
  // Require at least one numeric value or explicit measured status.
  if (status === "measured" || status === "estimated") return true;
  return Object.values(m).some((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * Verify a SearchOps-originated task with after_metric.
 * - Missing / unavailable after → verification_unavailable (never fake success).
 * - Measured before+after → verified + proof ledger entry.
 */
export async function verifySearchOpsTask(
  supabase: SupabaseClient,
  opts: {
    task: ExecutionTask;
    afterMetric: Record<string, unknown> | null;
    /** Explicit operator note when measurement could not be collected. */
    unavailableReason?: string | null;
  }
): Promise<VerifyOutcome> {
  const evidence = (opts.task.evidence || {}) as Record<string, unknown>;
  const opportunityId = String(evidence.searchops_opportunity_id || opts.task.source_id || "");

  if (!opts.afterMetric || !isMeasuredMetric(opts.afterMetric)) {
    const reason =
      opts.unavailableReason?.trim() ||
      "After metric unavailable — verification cannot claim no-impact or success.";
    const { data: task, error } = await supabase
      .from("execution_tasks")
      .update({
        status: "done",
        after_metric: {
          status: "unavailable",
          reason,
          captured_at: new Date().toISOString(),
        },
        result_metric: {
          outcome: "verification_unavailable",
          reason,
          searchops_opportunity_id: opportunityId || null,
        },
      })
      .eq("id", opts.task.id)
      .select("*")
      .single();
    if (error || !task) return { ok: false, error: error?.message || "Failed to update task" };
    return {
      ok: true,
      status: "verification_unavailable",
      task: task as ExecutionTask,
      reason,
    };
  }

  if (!isMeasuredMetric(opts.task.before_metric as Record<string, unknown> | null)) {
    return {
      ok: true,
      status: "verification_unavailable",
      task: opts.task,
      reason:
        "Before metric was never captured — cannot verify without a measured baseline. Re-create the task from the opportunity to snapshot before evidence.",
    };
  }

  const now = new Date().toISOString();
  const { data: task, error } = await supabase
    .from("execution_tasks")
    .update({
      status: "verified",
      verified_at: now,
      after_metric: opts.afterMetric,
      result_metric: {
        outcome: "verified",
        searchops_opportunity_id: opportunityId || null,
        verified_at: now,
      },
    })
    .eq("id", opts.task.id)
    .select("*")
    .single();

  if (error || !task) return { ok: false, error: error?.message || "Failed to verify task" };

  const ledger = await recordLedgerAction(supabase, {
    project_id: opts.task.project_id,
    task_id: opts.task.id,
    action_type: "searchops_opportunity_verified",
    action_surface: opts.task.category || "searchops",
    description: opts.task.title,
    baseline_snapshot: (opts.task.before_metric || {}) as ResultsLedgerEntry["baseline_snapshot"],
    outcome_snapshot: opts.afterMetric as ResultsLedgerEntry["outcome_snapshot"],
    delta_summary: {
      searchops_opportunity_id: opportunityId || null,
      source: "searchops_opportunity",
    },
    status: "verified",
    verified_at: now,
  } as Omit<ResultsLedgerEntry, "id" | "created_at" | "executed_at"> & { executed_at?: string });

  return {
    ok: true,
    status: "verified",
    task: task as ExecutionTask,
    ledgerId: ledger?.id ?? null,
  };
}
