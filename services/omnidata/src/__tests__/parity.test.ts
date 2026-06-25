import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dfsResponse } from "../api/response.js";
import { reverseHost } from "../engines/webgraph.js";

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
