import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProviderEnvelope, ProviderEnvelopeMetaSchema } from "@/lib/providers/envelope";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "envelope.golden.json"), "utf8")) as {
  schema_version: string;
  capability: string;
  required_fields: string[];
};

test("ProviderEnvelope golden shape is enforced by Zod", () => {
  const env = buildProviderEnvelope({
    capability: "serp",
    provider: "duckduckgo",
    providerClass: "surface_measurement",
    dataSource: "measured",
    freshness: "live",
    confidence: 0.9,
    parserVersion: "duckduckgo@1",
    payload: { organicResults: [] },
  });
  for (const field of golden.required_fields) {
    assert.ok(field in env, `missing envelope field: ${field}`);
  }
  assert.equal(env.schema_version, golden.schema_version);
  assert.ok(ProviderEnvelopeMetaSchema.safeParse(env).success);
});
