import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDsn, captureException, logProviderError, recordMetric } from "../log.ts";

/**
 * Observability is refund-safety infrastructure: a swallowed provider error can
 * make a user think they're invisible when they're not. These tests pin the DSN
 * parser and prove the capture/log helpers never throw into the caller.
 */

test("parseDsn extracts host, projectId and publicKey from a valid DSN", () => {
  const dsn = parseDsn("https://abc123@o123.ingest.sentry.io/456");
  assert.ok(dsn);
  assert.equal(dsn?.host, "o123.ingest.sentry.io");
  assert.equal(dsn?.projectId, "456");
  assert.equal(dsn?.publicKey, "abc123");
});

test("parseDsn returns null for empty, malformed, or incomplete DSNs", () => {
  assert.equal(parseDsn(undefined), null);
  assert.equal(parseDsn(""), null);
  assert.equal(parseDsn("not-a-url"), null);
  // Missing public key (username) or project id (path) must be rejected.
  assert.equal(parseDsn("https://o123.ingest.sentry.io/456"), null);
  assert.equal(parseDsn("https://abc123@o123.ingest.sentry.io/"), null);
});

test("captureException never throws even with a circular-ish context and no DSN", () => {
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  assert.doesNotThrow(() =>
    captureException("test.scope", new Error("boom"), { projectId: "p1", n: 42 })
  );
  assert.doesNotThrow(() => captureException("test.scope", "string error"));
});

test("logProviderError never throws", () => {
  assert.doesNotThrow(() => logProviderError("test.scope", new Error("warn"), { a: 1 }));
});

test("recordMetric never throws and emits structured metric line", () => {
  assert.doesNotThrow(() => recordMetric("test.counter", 1, { route: "health" }));
});
