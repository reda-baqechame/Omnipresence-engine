/**
 * Lightweight OpenTelemetry bootstrap — optional when OTEL_EXPORTER_OTLP_ENDPOINT
 * is set. Falls back to trace_id-only propagation via AsyncLocalStorage.
 */
import { getTraceId, ensureTraceId } from "./trace";

let otelReady = false;

export async function initOtel(serviceName = "omnipresence-engine"): Promise<void> {
  if (otelReady || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  try {
    process.env.OTEL_SERVICE_NAME = process.env.OTEL_SERVICE_NAME || serviceName;
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      }),
    });
    await sdk.start();
    otelReady = true;
  } catch {
    /* OTel is optional — never block requests */
  }
}

/** Bind trace context for a request handler. */
export function startRequestTrace(existingTraceId?: string): string {
  return ensureTraceId(existingTraceId);
}

export function currentTraceId(): string | undefined {
  return getTraceId();
}
