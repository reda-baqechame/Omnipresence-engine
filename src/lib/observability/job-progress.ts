/**
 * Patch D: reports.current_step / reports.progress_percent (and the same two
 * columns on visibility_runs) were added by migration 0078 and are already
 * read end-to-end by /api/jobs/running and rendered by RunningJobsStrip /
 * JobProgressBar — but no code path ever wrote them, so every running job
 * showed `currentStep: null` regardless of how far it had actually gotten.
 * This module is the one writer, shared by the deep-report gather/finalize
 * phases, the standard-report Inngest function, and the scan pipeline.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logProviderError } from "@/lib/observability/log";

export type ProgressTable = "reports" | "visibility_runs";

const PROGRESS_WRITE_THROTTLE_MS = 2000;

export interface StepProgressTracker {
  /** Call when a named step begins. Always attempts a write for the very
   * first step observed (so the UI shows movement immediately); throttled
   * thereafter. */
  onStepStart: (stepName: string) => Promise<void>;
  /** Call when a named step finishes; advances progress_percent. */
  onStepComplete: (stepName: string) => Promise<void>;
  /**
   * Fine-grained progress WITHIN a still-running step (e.g. "42 of 80
   * prompts probed"), for long steps like a scan's visibility_scan phase
   * that don't otherwise report anything between start and completion.
   * `fraction` must be in [0, 1]; throttled like every other write here.
   */
  onStepProgress: (stepName: string, fraction: number) => Promise<void>;
}

/**
 * Builds a throttled progress writer scoped to one job row. Never throws —
 * a progress-tracking failure must not fail or block the job it's tracking.
 * Every write is guarded by `.not("status","in","(cancelling,cancelled)")`
 * so a concurrent cancel request always wins and a cancelled row's
 * current_step/progress_percent is never silently overwritten afterward.
 */
export function createStepProgressTracker(
  supabase: SupabaseClient,
  table: ProgressTable,
  id: string,
  stepNames: readonly string[]
): StepProgressTracker {
  const total = Math.max(stepNames.length, 1);
  const completedCount = new Set<string>();
  let lastWriteAt = 0;
  let wroteAnything = false;

  async function write(currentStep: string, percent: number, force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && now - lastWriteAt < PROGRESS_WRITE_THROTTLE_MS) return;
    lastWriteAt = now;
    wroteAnything = true;
    // progress_percent is capped below 100 here — only the job's own final
    // "ready"/"complete" write (outside this tracker) is allowed to set 100,
    // so a reader can never see 100% alongside a non-terminal status.
    const clamped = Math.min(99, Math.max(0, Math.round(percent)));
    try {
      await supabase
        .from(table)
        .update({ current_step: currentStep, progress_percent: clamped })
        .eq("id", id)
        .not("status", "in", "(cancelling,cancelled)");
    } catch (e) {
      logProviderError("job-progress.write", e, { table, id, step: currentStep });
    }
  }

  return {
    async onStepStart(stepName: string) {
      const idx = stepNames.indexOf(stepName);
      const percent = idx >= 0 ? (idx / total) * 100 : (completedCount.size / total) * 100;
      await write(stepName, percent, !wroteAnything);
    },
    async onStepComplete(stepName: string) {
      completedCount.add(stepName);
      const percent = (completedCount.size / total) * 100;
      await write(stepName, percent, false);
    },
    async onStepProgress(stepName: string, fraction: number) {
      const idx = stepNames.indexOf(stepName);
      if (idx < 0) return;
      const clampedFraction = Math.min(1, Math.max(0, fraction));
      const percent = ((idx + clampedFraction) / total) * 100;
      await write(stepName, percent, false);
    },
  };
}
