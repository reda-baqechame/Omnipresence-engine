import { createHash } from "crypto";
import { z } from "zod";
import type { DataQuality } from "@/types/database";
import type { ProviderCategory } from "@/lib/config/capabilities";
import { getTraceId } from "@/lib/observability/trace";

export const PROVIDER_ENVELOPE_VERSION = "2026-07-01" as const;

export const DataSourceSchema = z.enum([
  "measured",
  "estimated",
  "model_knowledge",
  "simulated",
  "unavailable",
]);

export const EnvelopeCapabilitySchema = z.enum([
  "serp",
  "crawl",
  "backlinks",
  "generate",
  "email",
  "social",
  "enrich",
  "pagespeed",
  "crux",
]);

export type EnvelopeCapability = z.infer<typeof EnvelopeCapabilitySchema>;

export const FreshnessSchema = z.enum(["live", "recent", "cached", "none"]);

export const ProviderEnvelopeMetaSchema = z.object({
  schema_version: z.literal(PROVIDER_ENVELOPE_VERSION),
  capability: EnvelopeCapabilitySchema,
  provider: z.string(),
  provider_class: z.enum([
    "surface_measurement",
    "internal_reasoning",
    "execution",
    "benchmark_only",
    "fallback_only",
  ]),
  data_source: DataSourceSchema,
  freshness: FreshnessSchema,
  confidence: z.number().min(0).max(1),
  measured_at: z.string().datetime(),
  source_url: z.string().url().optional(),
  parser_version: z.string(),
  response_hash: z.string().min(16),
  evidence_ref: z.string().uuid().optional(),
  trace_id: z.string().optional(),
  tenant: z
    .object({
      organization_id: z.string().uuid(),
      project_id: z.string().uuid(),
    })
    .optional(),
});

export type ProviderEnvelopeMeta = z.infer<typeof ProviderEnvelopeMetaSchema>;

export interface BuildEnvelopeInput {
  capability: EnvelopeCapability;
  provider: string;
  providerClass: ProviderCategory;
  dataSource: DataQuality;
  freshness?: z.infer<typeof FreshnessSchema>;
  confidence?: number;
  sourceUrl?: string;
  parserVersion?: string;
  payload: unknown;
  tenant?: { organizationId: string; projectId: string };
  evidenceRef?: string;
  traceId?: string;
}

export function hashPayload(payload: unknown): string {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  return createHash("sha256").update(raw).digest("hex");
}

export function buildProviderEnvelope(input: BuildEnvelopeInput): ProviderEnvelopeMeta {
  const envelope: ProviderEnvelopeMeta = {
    schema_version: PROVIDER_ENVELOPE_VERSION,
    capability: input.capability,
    provider: input.provider,
    provider_class: input.providerClass,
    data_source: input.dataSource,
    freshness: input.freshness ?? "live",
    confidence: input.confidence ?? 0.85,
    measured_at: new Date().toISOString(),
    source_url: input.sourceUrl,
    parser_version: input.parserVersion ?? "1.0.0",
    response_hash: hashPayload(input.payload),
    evidence_ref: input.evidenceRef,
    trace_id: input.traceId ?? getTraceId(),
    tenant: input.tenant
      ? { organization_id: input.tenant.organizationId, project_id: input.tenant.projectId }
      : undefined,
  };
  return ProviderEnvelopeMetaSchema.parse(envelope);
}
