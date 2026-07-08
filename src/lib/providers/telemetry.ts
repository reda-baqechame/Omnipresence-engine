import type { SupabaseClient } from "@supabase/supabase-js";
import { getTraceId } from "@/lib/observability/trace";
import { getJobContext } from "@/lib/observability/job-context";
import { recordMetric } from "@/lib/observability/log";

export interface ProviderTelemetryInput {
  capability: string;
  provider: string;
  success: boolean;
  latencyMs: number;
  costUsd?: number;
  errorMessage?: string;
  organizationId?: string;
  projectId?: string;
  /** Defaults to the active job context (withJobContext) when omitted. */
  reportId?: string;
  runId?: string;
}

/** Fire-and-forget telemetry row + structured metric (never throws). */
export function recordProviderTelemetry(
  supabase: SupabaseClient | null,
  input: ProviderTelemetryInput
): void {
  recordMetric("provider.route.latency_ms", input.latencyMs, {
    capability: input.capability,
    provider: input.provider,
    success: input.success,
  });
  if (!supabase) return;
  const job = getJobContext();
  void supabase
    .from("provider_telemetry")
    .insert({
      capability: input.capability,
      provider: input.provider,
      success: input.success,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      cost_usd: input.costUsd ?? 0,
      error_message: input.errorMessage?.slice(0, 500) ?? null,
      trace_id: getTraceId() ?? null,
      organization_id: input.organizationId ?? null,
      project_id: input.projectId ?? null,
      report_id: input.reportId ?? job?.reportId ?? null,
      run_id: input.runId ?? job?.runId ?? null,
    })
    .then(({ error }) => {
      if (error) recordMetric("provider.telemetry.write_failed", 1, { provider: input.provider });
    });
}
