import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signWebhookBody, resolveEndpoints } from "../webhooks.ts";

/**
 * Unit tests for outbound webhook signing + endpoint resolution (Wave T3).
 * Receivers must be able to recompute the signature, and the global env list
 * must resolve into signed endpoints.
 */

test("signWebhookBody produces a verifiable sha256 HMAC", () => {
  const body = JSON.stringify({ event: "scan.completed", n: 1 });
  const secret = "s3cr3t";
  const sig = signWebhookBody(body, secret);
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(sig, expected);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});

test("a tampered body fails verification", () => {
  const secret = "s3cr3t";
  const good = signWebhookBody('{"a":1}', secret);
  const bad = signWebhookBody('{"a":2}', secret);
  assert.notEqual(good, bad);
});

test("resolveEndpoints reads the comma-separated env list + signing secret", () => {
  const prevUrls = process.env.OUTBOUND_WEBHOOK_URLS;
  const prevSecret = process.env.OUTBOUND_WEBHOOK_SECRET;
  process.env.OUTBOUND_WEBHOOK_URLS = "https://a.example/hook, https://b.example/hook";
  process.env.OUTBOUND_WEBHOOK_SECRET = "abc";
  try {
    const endpoints = resolveEndpoints([{ url: "https://c.example/extra" }]);
    assert.equal(endpoints.length, 3);
    assert.equal(endpoints[0].url, "https://a.example/hook");
    assert.equal(endpoints[0].secret, "abc");
    assert.equal(endpoints[2].url, "https://c.example/extra");
  } finally {
    process.env.OUTBOUND_WEBHOOK_URLS = prevUrls;
    process.env.OUTBOUND_WEBHOOK_SECRET = prevSecret;
  }
});

test("resolveEndpoints is empty when nothing configured", () => {
  const prev = process.env.OUTBOUND_WEBHOOK_URLS;
  delete process.env.OUTBOUND_WEBHOOK_URLS;
  try {
    assert.equal(resolveEndpoints().length, 0);
  } finally {
    if (prev !== undefined) process.env.OUTBOUND_WEBHOOK_URLS = prev;
  }
});
