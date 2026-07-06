import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProviderEnvelope,
  ProviderEnvelopeMetaSchema,
  PROVIDER_ENVELOPE_VERSION,
  hashPayload,
} from "@/lib/providers/envelope";
import { withTraceId } from "@/lib/observability/trace";

test("buildProviderEnvelope emits a valid versioned envelope", () => {
  const payload = { organicResults: [{ title: "t", url: "https://x.com", position: 1 }] };
  const env = buildProviderEnvelope({
    capability: "serp",
    provider: "duckduckgo",
    providerClass: "surface_measurement",
    dataSource: "measured",
    freshness: "live",
    confidence: 0.9,
    parserVersion: "duckduckgo@1",
    payload,
  });
  assert.equal(env.schema_version, PROVIDER_ENVELOPE_VERSION);
  assert.equal(env.capability, "serp");
  assert.equal(env.response_hash, hashPayload(payload));
  assert.ok(ProviderEnvelopeMetaSchema.safeParse(env).success);
});

test("buildProviderEnvelope propagates trace_id from async context", () => {
  const traceId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  withTraceId(traceId, () => {
    const env = buildProviderEnvelope({
      capability: "backlinks",
      provider: "omnidata-webgraph",
      providerClass: "surface_measurement",
      dataSource: "measured",
      parserVersion: "backlinks-free@1",
      payload: [],
    });
    assert.equal(env.trace_id, traceId);
  });
});
