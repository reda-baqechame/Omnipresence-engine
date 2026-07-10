import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BillingCheckoutSchema, V1ScanSchema, parseOrError } from "@/lib/validation/schemas";

const root = join(import.meta.dirname, "../../../..");

/** Route smoke contracts — file exists, exports handler, enforces auth or public guard. */
const ROUTE_SMOKE: Array<{
  path: string;
  handler: "GET" | "POST";
  mustInclude: string[];
}> = [
  { path: "app/api/health/route.ts", handler: "GET", mustInclude: ["export async function GET", "isHealthAuthorized", "ok: true"] },
  { path: "app/api/admin/benchmark-runs/route.ts", handler: "GET", mustInclude: ["export async function GET", "isPlatformAdminAuthorized", "apiUnauthorized", "auditDataForSeoCategories", "demotionReadinessReport"] },
  { path: "app/api/admin/benchmark-readiness/route.ts", handler: "GET", mustInclude: ["export async function GET", "isPlatformAdminAuthorized", "apiUnauthorized", "buildBenchmarkReadinessReport"] },
  { path: "app/api/admin/provider-proof/route.ts", handler: "GET", mustInclude: ["export async function GET", "isPlatformAdminAuthorized", "apiUnauthorized", "loadProviderProofCockpit"] },
  { path: "app/api/searchops/gsc-opportunities/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized", "buildGscInsights"] },
  { path: "app/api/searchops/tasks-from-opportunity/route.ts", handler: "POST", mustInclude: ["export async function POST", "verifyProjectAccess", "apiUnauthorized", "createTaskFromOpportunity"] },
  { path: "app/api/searchops/verify-task/route.ts", handler: "POST", mustInclude: ["export async function POST", "verifyProjectAccess", "apiUnauthorized", "verifySearchOpsTask"] },
  { path: "app/api/capabilities/route.ts", handler: "GET", mustInclude: ["export async function GET", "getUser()", "Unauthorized"] },
  { path: "app/api/coverage/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/cwv/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/entity/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/frontier/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/guarantee/route.ts", handler: "GET", mustInclude: ["export async function GET", "guardPublicEndpoint", "apiUnauthorized"] },
  { path: "app/api/indexation/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/roi/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/ranks/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/behavior/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/local/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/merchant/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/on-page/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/ppc/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/reputation/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/topical/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/community/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/authority/route.ts", handler: "GET", mustInclude: ["export async function GET", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/links/route.ts", handler: "POST", mustInclude: ["export async function POST", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/schema/route.ts", handler: "POST", mustInclude: ["export async function POST", "verifyProjectAccess", "apiUnauthorized"] },
  { path: "app/api/trends/route.ts", handler: "GET", mustInclude: ["export async function GET", "guardPublicEndpoint", "apiUnauthorized"] },
  { path: "app/api/content/route.ts", handler: "POST", mustInclude: ["export async function POST", "verifyProjectAccess", "trackApiUsage"] },
  { path: "app/api/semantic/route.ts", handler: "POST", mustInclude: ["export async function POST", "verifyProjectAccess", "apiUnauthorized"] },
];

test("billing checkout rejects invalid plan via Zod", () => {
  const parsed = parseOrError(BillingCheckoutSchema, { plan: "not-a-plan" });
  assert.equal(parsed.ok, false);
  const valid = parseOrError(BillingCheckoutSchema, { plan: "tracking" });
  assert.equal(valid.ok, true);
});

test("v1 scan schema requires projectIds or all:true", () => {
  const bad = parseOrError(V1ScanSchema, {});
  assert.equal(bad.ok, false);
  const good = parseOrError(V1ScanSchema, { all: true });
  assert.equal(good.ok, true);
  const ids = parseOrError(V1ScanSchema, {
    projectIds: ["550e8400-e29b-41d4-a716-446655440000"],
  });
  assert.equal(ids.ok, true);
});

test("hardened route schema registry has at least 30 entries", async () => {
  const mod = await import("@/lib/validation/schemas");
  const count = Object.keys(mod.HARDENED_ROUTE_SCHEMAS).length;
  assert.ok(count >= 30, `expected >=30 hardened routes, got ${count}`);
});

test("API route smoke contracts (>=15 routes)", () => {
  assert.ok(ROUTE_SMOKE.length >= 15, "need at least 15 route smoke entries");
  for (const route of ROUTE_SMOKE) {
    const file = join(root, "src", route.path);
    assert.ok(existsSync(file), `missing route file ${route.path}`);
    const src = readFileSync(file, "utf8");
    for (const needle of route.mustInclude) {
      assert.ok(src.includes(needle), `${route.path} should include ${needle}`);
    }
  }
});
