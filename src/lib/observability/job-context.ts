import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Implicit per-job context (reportId / visibility run id) for cost/token
 * attribution, read by cost-guard.ts / telemetry.ts deep inside provider call
 * sites without threading an extra parameter through every function
 * signature in the call chain.
 *
 * Backed by AsyncLocalStorage (Node-only; this codebase has no Edge routes,
 * so that's safe — see trace.ts for the Edge-safe plain-variable pattern used
 * where Edge compatibility does matter). Unlike a plain module-level
 * variable, this correctly isolates concurrent jobs that happen to run
 * concurrently on the same warm server/worker process (e.g. two Inngest
 * functions executing on the same instance, or overlapping requests) — each
 * async call chain sees only the job context it was started with, so cost
 * and token attribution can never leak from one report/scan onto another.
 */
export interface JobContext {
  reportId?: string;
  runId?: string;
}

const storage = new AsyncLocalStorage<JobContext>();

export async function withJobContext<T>(job: JobContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(job, fn);
}

export function getJobContext(): JobContext | undefined {
  return storage.getStore();
}
