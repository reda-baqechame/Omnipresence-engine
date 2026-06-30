import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveConnectorReport, type ConnectionRow } from "../connector-health.ts";

/**
 * Unit tests for the outcome-guarantee gate (Wave S3). The refund-critical
 * invariant: outcomeGuaranteeEligible is true ONLY when a healthy revenue/
 * lead/traffic source is connected and syncing.
 */

const future = new Date(Date.now() + 86400000).toISOString();
const recent = new Date().toISOString();
const old = new Date(Date.now() - 30 * 86400000).toISOString();

test("no connections => outcome guarantee NOT eligible", () => {
  const r = deriveConnectorReport("p", []);
  assert.equal(r.outcomeGuaranteeEligible, false);
  assert.equal(r.hasAnyConnection, false);
  assert.match(r.reason, /No first-party data connected/);
});

test("healthy GA4 connection => eligible", () => {
  const rows: ConnectionRow[] = [
    { provider: "google_analytics", access_token: "t", expires_at: future, updated_at: recent },
  ];
  const r = deriveConnectorReport("p", rows, { google_analytics: true });
  assert.equal(r.outcomeGuaranteeEligible, true);
  assert.match(r.reason, /Outcome guarantee active/);
});

test("only a traffic-signal (GSC) source => connected but NOT outcome-eligible", () => {
  const rows: ConnectionRow[] = [
    { provider: "google_search_console", access_token: "t", expires_at: future, updated_at: recent },
  ];
  const r = deriveConnectorReport("p", rows);
  assert.equal(r.hasAnyConnection, true);
  assert.equal(r.outcomeGuaranteeEligible, false);
  assert.match(r.reason, /only deterministic/);
});

test("expired token is not healthy => not eligible", () => {
  const rows: ConnectionRow[] = [
    { provider: "stripe", access_token: "t", expires_at: old, updated_at: recent },
  ];
  const r = deriveConnectorReport("p", rows);
  const stripe = r.connectors.find((c) => c.provider === "stripe")!;
  assert.equal(stripe.health, "expired");
  assert.equal(r.outcomeGuaranteeEligible, false);
});

test("connected but last sync failed => marked stale, not eligible", () => {
  const rows: ConnectionRow[] = [
    { provider: "shopify", access_token: "t", expires_at: future, updated_at: recent },
  ];
  const r = deriveConnectorReport("p", rows, { shopify: false });
  const shopify = r.connectors.find((c) => c.provider === "shopify")!;
  assert.equal(shopify.health, "stale");
  assert.equal(r.outcomeGuaranteeEligible, false);
});
