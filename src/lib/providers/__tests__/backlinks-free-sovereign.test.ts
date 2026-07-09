/**
 * Patch J / Master Build Phase 1: sovereign backlinks adapter must never
 * call paid Labs (hasLabsApi) — paid failover belongs only on the
 * dataforseo-backlinks router adapter via fetchBacklinks().
 *
 * Pure source-text assertions (no TS loader / esbuild required).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../backlinks-free.ts"), "utf8");

test("getBacklinksFree source does not import or call hasLabsApi (paid bypass removed)", () => {
  assert.equal(/hasLabsApi/.test(src), false, "hasLabsApi must not appear in backlinks-free.ts");
});

test("getBacklinksFree gates on isOmniDataActive only for the real-index path", () => {
  assert.match(src, /isOmniDataActive\(\)/);
  assert.match(src, /omnidata-webgraph/);
  assert.equal(/provider:\s*"dataforseo"/.test(src), false, "must not label sovereign path as dataforseo");
});

test("error message points callers at fetchBacklinks router failover", () => {
  assert.match(src, /fetchBacklinks\(\)/);
});
