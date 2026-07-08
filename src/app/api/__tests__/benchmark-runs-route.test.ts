import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch J: GET /api/admin/benchmark-runs must, on top of Patch H's existing
 * benchmark_runs summary, surface the DataForSEO fallback-only enforcement
 * gate — real router.ts adapter categories audited against the standing
 * invariant, plus per-capability promotion-readiness derived from the SAME
 * summarized benchmark evidence already in the response. This pins that the
 * route actually calls the real router describeProviders() + the demotion
 * gate rather than only computing the Patch H groups.
 */

let authorized = true;
mock.module("@/lib/security/admin-auth", {
  namedExports: {
    isPlatformAdminAuthorized: async () => authorized,
  },
});

let benchmarkRows: unknown[] = [];
mock.module("@/lib/supabase/server", {
  namedExports: {
    createServiceClient: async () => ({
      from: (table: string) => {
        assert.equal(table, "benchmark_runs");
        return {
          select: () => ({
            gte: () => ({
              order: () => ({
                limit: async () => ({ data: benchmarkRows, error: null }),
              }),
            }),
          }),
        };
      },
    }),
  },
});

let describeProvidersResult: Array<{ id: string; capability: string; category: string; paid: boolean }> = [
  { id: "dataforseo", capability: "serp", category: "fallback_only", paid: true },
  { id: "dataforseo-backlinks", capability: "backlinks", category: "fallback_only", paid: true },
  { id: "omnidata", capability: "serp", category: "surface_measurement", paid: false },
];
mock.module("@/lib/providers/router", {
  namedExports: {
    describeProviders: async () => describeProvidersResult,
  },
});

const { GET } = await import("../admin/benchmark-runs/route.ts");

function req(query = "") {
  return new NextRequest(`http://localhost/api/admin/benchmark-runs${query}`);
}

test("admin/benchmark-runs: unauthorized caller is rejected before any DB/router call", async () => {
  authorized = false;
  const res = await GET(req());
  assert.equal(res.status, 401);
  authorized = true;
});

test("admin/benchmark-runs: healthy deploy reports zero category violations", async () => {
  benchmarkRows = [];
  const res = await GET(req());
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.dataForSeoCategoryViolations, []);
});

test("admin/benchmark-runs: a router.ts regression (DataForSEO promoted) is surfaced as a violation", async () => {
  describeProvidersResult = [
    { id: "dataforseo", capability: "serp", category: "surface_measurement", paid: true },
  ];
  const res = await GET(req());
  const body = await res.json();
  assert.equal(body.dataForSeoCategoryViolations.length, 1);
  assert.match(body.dataForSeoCategoryViolations[0], /dataforseo/);
  describeProvidersResult = [
    { id: "dataforseo", capability: "serp", category: "fallback_only", paid: true },
    { id: "dataforseo-backlinks", capability: "backlinks", category: "fallback_only", paid: true },
    { id: "omnidata", capability: "serp", category: "surface_measurement", paid: false },
  ];
});

test("admin/benchmark-runs: dataForSeoDemotion has one entry per capability with a registered DataForSEO adapter", async () => {
  benchmarkRows = [];
  const res = await GET(req());
  const body = await res.json();
  const capabilities = body.dataForSeoDemotion.map((d: { capability: string }) => d.capability).sort();
  assert.deepEqual(capabilities, ["backlinks", "serp"]);
  for (const status of body.dataForSeoDemotion) {
    assert.equal(status.currentlyEnforced, true);
    assert.equal(status.evidenceSupportsFurtherDemotion, false, "no benchmark rows yet -> never claim readiness");
  }
});

test("admin/benchmark-runs: a real 30-day passing streak in benchmark_runs surfaces as evidenceSupportsFurtherDemotion", async () => {
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return {
      id: `row-${i}`,
      capability: "serp",
      metric_name: "failure_rate",
      sovereign_provider: "duckduckgo",
      paid_provider: null,
      dataset_ref: "q1",
      sovereign_value: 0.01,
      paid_value: null,
      delta: null,
      passed: true,
      threshold_note: "note",
      run_at: d.toISOString(),
    };
  });
  benchmarkRows = days;
  const res = await GET(req());
  const body = await res.json();
  const serpStatus = body.dataForSeoDemotion.find((d: { capability: string }) => d.capability === "serp");
  assert.equal(serpStatus.evidenceSupportsFurtherDemotion, true);
  benchmarkRows = [];
});
