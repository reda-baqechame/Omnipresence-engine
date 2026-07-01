/**
 * Rank schedule runner (Phase 3).
 * Executes due rank_schedules and records run audit rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAllRankChecks } from "@/lib/engines/rank-tracker-service";

export async function runDueRankSchedules(supabase: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const { data: schedules } = await supabase
    .from("rank_schedules")
    .select("id, project_id, cadence, name")
    .eq("is_active", true)
    .or(`next_run_at.is.null,next_run_at.lte.${now}`)
    .limit(50);

  if (!schedules?.length) return 0;

  let ran = 0;
  for (const sched of schedules) {
    const { data: run } = await supabase
      .from("rank_schedule_runs")
      .insert({
        schedule_id: sched.id,
        project_id: sched.project_id,
        status: "running",
        started_at: now,
      })
      .select("id")
      .single();

    try {
      const { data: project } = await supabase.from("projects").select("domain").eq("id", sched.project_id).single();
      const results = await runAllRankChecks(supabase, sched.project_id, project?.domain || "");
      const count = results.length;
      const next = nextRunAt(sched.cadence);
      await supabase
        .from("rank_schedules")
        .update({ last_run_at: now, next_run_at: next, updated_at: now })
        .eq("id", sched.id);
      if (run?.id) {
        await supabase
          .from("rank_schedule_runs")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            result_summary: { keywords_checked: count },
          })
          .eq("id", run.id);
      }
      ran++;
    } catch (e) {
      if (run?.id) {
        await supabase
          .from("rank_schedule_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: e instanceof Error ? e.message : "rank schedule failed",
          })
          .eq("id", run.id);
      }
    }
  }
  return ran;
}

function nextRunAt(cadence: string): string {
  const d = new Date();
  if (cadence === "hourly") d.setHours(d.getHours() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/** Create a weekly default schedule when the first keyword is tracked. */
export async function ensureDefaultRankSchedule(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string
): Promise<void> {
  const { count } = await supabase
    .from("rank_schedules")
    .select("*", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (count && count > 0) return;

  const next = nextRunAt("weekly");
  await supabase.from("rank_schedules").upsert(
    {
      project_id: projectId,
      organization_id: organizationId,
      name: "default",
      cadence: "weekly",
      is_active: true,
      next_run_at: next,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,name" }
  );
}
