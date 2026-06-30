import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBlock, isBlocked } from "../capture.js";

/**
 * Honesty guards for the capture layer (no browser needed):
 *  - detectBlock recognizes captcha / rate-limit / consent walls so we return an
 *    explicit "blocked" outcome instead of fabricating an answer.
 *  - isBlocked narrows the outcome union correctly.
 */

test("detectBlock flags captcha / rate-limit / consent walls", () => {
  assert.ok(detectBlock("https://www.google.com/sorry/index", "unusual traffic from your network"));
  assert.ok(detectBlock("https://x", "Please verify you are human"));
  assert.ok(detectBlock("https://consent.google.com/...", "before you continue to google"));
  assert.ok(detectBlock("https://x", "Too Many Requests"));
});

test("detectBlock returns null for a genuine answer page", () => {
  assert.equal(
    detectBlock("https://www.perplexity.ai/search?q=best+crm", "Asana and Trello are popular project tools."),
    null
  );
});

test("isBlocked narrows the capture outcome", () => {
  assert.equal(isBlocked({ blocked: true, reason: "captcha" }), true);
  assert.equal(isBlocked(null), false);
  assert.equal(
    isBlocked({ answer: "x", citedUrls: [], responseHash: "h", context: { locale: "en-US", persona: "desktop" } }),
    false
  );
});
