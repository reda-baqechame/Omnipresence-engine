import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("ProjectionBadge surfaces projected honesty copy", () => {
  const src = readFileSync(join(root, "projection-badge.tsx"), "utf8");
  assert.match(src, /Projected/);
  assert.match(src, /not a measured value/i);
});

test("DataTrustCenter fetches trust API and shows provenance", () => {
  const src = readFileSync(join(root, "data-trust-center.tsx"), "utf8");
  assert.match(src, /\/api\/projects\/\$\{projectId\}\/trust/);
  assert.match(src, /ProvenanceBadge/);
});

test("CompetitorComparison labels proxies honestly", () => {
  const src = readFileSync(join(root, "competitor-comparison.tsx"), "utf8");
  assert.match(src, /not visit counts/i);
  assert.match(src, /getCompetitiveSnapshot/);
});
