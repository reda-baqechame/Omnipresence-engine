/**
 * Implicit per-job context (reportId / visibility run id) for cost/token
 * attribution, mirroring the existing trace-id pattern in trace.ts. Set once
 * at the top of a report-generation or scan run, read by cost-guard.ts /
 * telemetry.ts deep inside provider call sites without threading an extra
 * parameter through every function signature in the call chain.
 *
 * Same caveat as trace.ts: this is a plain module-level variable, not
 * AsyncLocalStorage — safe for the "set once, await the whole job" usage
 * pattern this codebase already relies on for trace_id, not for arbitrarily
 * interleaved concurrent jobs sharing one warm instance.
 */
export interface JobContext {
  reportId?: string;
  runId?: string;
}

let activeJob: JobContext | undefined;

export async function withJobContext<T>(job: JobContext, fn: () => Promise<T>): Promise<T> {
  const prev = activeJob;
  activeJob = job;
  try {
    return await fn();
  } finally {
    activeJob = prev;
  }
}

export function getJobContext(): JobContext | undefined {
  return activeJob;
}
