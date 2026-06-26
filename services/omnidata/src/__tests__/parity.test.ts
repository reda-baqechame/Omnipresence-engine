import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dfsResponse } from "../api/response.js";
import { reverseHost } from "../engines/webgraph.js";
import { detectFromResponse } from "../engines/techstack.js";
import { computeDifficulty } from "../engines/keyword-difficulty.js";

/**
 * Parity checks: the OmniData engine must speak DataForSEO's response shape so
 * the Next.js app can route to either provider without code changes. These run
 * offline (no API keys) and assert structural parity, not live data values.
 */
describe("DataForSEO envelope parity", () => {
  test("success envelope has the DataForSEO-compatible top-level keys", () => {
    const env = dfsResponse([{ result: [{ items: [] }] }]);
    assert.ok("version" in env);
    assert.equal(env.status_code, 20000);
    assert.equal(env.status_message, "Ok.");
    assert.equal(env.tasks_count, 1);
    assert.equal(env.tasks_error, 0);
    assert.ok(Array.isArray(env.tasks));
    assert.ok(Array.isArray((env.tasks[0] as { result: unknown[] }).result));
  });

  test("error envelope flags tasks_error", () => {
    const env = dfsResponse([], 40000);
    assert.equal(env.status_code, 40000);
    assert.equal(env.tasks_count, 0);
  });
});

describe("webgraph host reversal parity (Common Crawl format)", () => {
  test("reverses host to Common Crawl reversed-domain form", () => {
    assert.equal(reverseHost("example.com"), "com.example");
    assert.equal(reverseHost("https://www.sub.example.co.uk/path"), "uk.co.example.sub");
  });
});

describe("tech-stack fingerprint detection (Phase 11)", () => {
  test("detects CMS from meta + body and CDN/server from headers", () => {
    const html = `<!doctype html><html><head>
      <meta name="generator" content="WordPress 6.5" />
      </head><body><link href="/wp-content/themes/x/style.css"></body></html>`;
    const headers = { server: "cloudflare", "cf-ray": "abc123", "x-powered-by": "Next.js" };
    const result = detectFromResponse("https://example.com", html, headers);
    const names = result.technologies.map((t) => t.name);
    assert.ok(result.available);
    assert.ok(names.includes("WordPress"));
    assert.ok(names.includes("Cloudflare"));
    assert.ok(result.categories["CMS"]?.includes("WordPress"));
    assert.equal(result.data_source, "fingerprint");
  });

  test("returns available=false when nothing matches", () => {
    const result = detectFromResponse("https://example.com", "<html><body>hi</body></html>", {});
    assert.equal(result.available, false);
    assert.equal(result.technologies.length, 0);
  });

  test("tech result wraps cleanly in the DataForSEO envelope", () => {
    const result = detectFromResponse("https://example.com", '<div id="__next"></div>', {});
    const env = dfsResponse([{ result: [result] }]);
    assert.equal(env.status_code, 20000);
    const wrapped = (env.tasks[0] as { result: Array<{ technologies: unknown[] }> }).result[0];
    assert.ok(Array.isArray(wrapped.technologies));
  });
});

describe("keyword difficulty from ranking authority (Phase 12)", () => {
  test("real method: high-authority SERP yields high KD", () => {
    const authorityMap = new Map([
      ["wikipedia.org", 95],
      ["forbes.com", 88],
      ["nytimes.com", 90],
    ]);
    const { difficulty, method } = computeDifficulty({
      domains: ["wikipedia.org", "forbes.com", "nytimes.com"],
      serpFeatureTypes: ["ai_overview"],
      authorityMap,
    });
    assert.equal(method, "ranking_authority");
    assert.ok(difficulty >= 80, `expected hard KD, got ${difficulty}`);
  });

  test("real method: low-authority SERP yields low KD", () => {
    const authorityMap = new Map([
      ["smallblog.io", 8],
      ["niche-forum.net", 5],
    ]);
    const { difficulty, method } = computeDifficulty({
      domains: ["smallblog.io", "niche-forum.net"],
      serpFeatureTypes: [],
      authorityMap,
    });
    assert.equal(method, "ranking_authority");
    assert.ok(difficulty < 30, `expected easy KD, got ${difficulty}`);
  });

  test("falls back to heuristic when no authority map is available", () => {
    const { method } = computeDifficulty({
      domains: ["a.com", "b.com", "c.com"],
      serpFeatureTypes: [],
      authorityMap: new Map(),
    });
    assert.equal(method, "heuristic");
  });
});
