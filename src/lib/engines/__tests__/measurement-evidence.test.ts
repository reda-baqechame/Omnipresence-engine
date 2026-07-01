import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { recordMeasurementEvidence, responseHash } from "../evidence.ts";

/**
 * Pins the first-class measurement-evidence spine (Phase 1, presence-os-110):
 *  - only real measured/estimated data earns an evidence row (honesty guard),
 *  - the row carries a tamper-evident sha256 of the raw payload,
 *  - storage is best-effort: a storage failure still yields a durable DB row,
 *  - a hard DB failure returns null (caller treats evidence as absent),
 *  - it NEVER throws (a measurement must never fail because of evidence I/O).
 */

interface Uploaded { path: string; body: unknown }

function mockSupabase(opts: { storageFails?: boolean; dbFails?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const uploaded: Uploaded[] = [];
  return {
    inserted,
    uploaded,
    storage: {
      from() {
        return {
          async upload(path: string, body: unknown) {
            if (opts.storageFails) return { error: new Error("storage down"), data: null };
            uploaded.push({ path, body });
            return { error: null, data: { path } };
          },
        };
      },
    },
    from() {
      return {
        async insert(payload: Record<string, unknown>) {
          if (opts.dbFails) return { error: new Error("db down") };
          inserted.push(payload);
          return { error: null };
        },
      };
    },
  };
}

test("records a tamper-evident row for measured data and uploads the artifact", async () => {
  const sb = mockSupabase();
  const payload = { organic: [{ url: "https://a.com", position: 1 }] };
  const rec = await recordMeasurementEvidence(sb as never, {
    projectId: "p1",
    capability: "rank",
    target: "best crm",
    provider: "serp",
    sourceUrl: "https://a.com",
    parserVersion: "rank-tracker@1",
    dataSource: "measured",
    confidence: 0.8,
    rawPayload: payload,
    excerpt: { position: 1 },
  });
  assert.ok(rec, "a record is returned");
  assert.equal(rec!.responseHash, createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex"));
  assert.equal(sb.inserted.length, 1);
  assert.equal(sb.inserted[0].capability, "rank");
  assert.equal(sb.inserted[0].response_hash, rec!.responseHash);
  assert.equal(sb.inserted[0].data_source, "measured");
  assert.equal(sb.uploaded.length, 1, "artifact uploaded to storage");
  assert.equal(rec!.evidenceUrl, sb.uploaded[0].path);
});

test("honesty guard: unavailable/simulated data earns NO evidence row", async () => {
  for (const ds of ["unavailable", "simulated"]) {
    const sb = mockSupabase();
    const rec = await recordMeasurementEvidence(sb as never, {
      projectId: "p1", capability: "rank", target: "x", dataSource: ds, rawPayload: {},
    });
    assert.equal(rec, null, `${ds} must not be evidenced`);
    assert.equal(sb.inserted.length, 0);
  }
});

test("storage failure still yields a durable DB row (DB is the proof)", async () => {
  const sb = mockSupabase({ storageFails: true });
  const rec = await recordMeasurementEvidence(sb as never, {
    projectId: "p1", capability: "pagespeed", target: "a.com", dataSource: "measured", rawPayload: { lcp: 1200 },
  });
  assert.ok(rec, "record still created");
  assert.equal(rec!.evidenceUrl, null, "no storage artifact path on storage failure");
  assert.equal(sb.inserted.length, 1, "DB row persisted regardless");
});

test("hard DB failure returns null and never throws", async () => {
  const sb = mockSupabase({ dbFails: true });
  const rec = await recordMeasurementEvidence(sb as never, {
    projectId: "p1", capability: "rank", target: "x", dataSource: "measured", rawPayload: {},
  });
  assert.equal(rec, null);
});

test("non-finite confidence is stored as null (no fabricated precision)", async () => {
  const sb = mockSupabase();
  await recordMeasurementEvidence(sb as never, {
    projectId: "p1", capability: "rank", target: "x", dataSource: "measured", confidence: NaN, rawPayload: {},
  });
  assert.equal(sb.inserted[0].confidence, null);
});

test("responseHash is a stable sha256 of the input text", () => {
  assert.equal(responseHash("abc"), createHash("sha256").update("abc", "utf8").digest("hex"));
  assert.equal(responseHash(""), createHash("sha256").update("", "utf8").digest("hex"));
});

test("presence gate evidence rate drops when measurement_evidence is sparse", async () => {
  const { gateFromRate } = await import("../../scoring/presence-gate.ts");
  const strong = gateFromRate("evidence", 0.8, true, "8/10 evidenced").score;
  const weak = gateFromRate("evidence", 0.1, true, "1/10 evidenced").score;
  assert.ok(strong > weak, "missing evidence lowers evidence gate score");
});
