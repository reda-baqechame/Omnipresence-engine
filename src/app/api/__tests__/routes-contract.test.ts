import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../../../..");

const ROUTES: Array<{ path: string; mustInclude: string[] }> = [
  { path: "app/api/health/route.ts", mustInclude: ["isHealthAuthorized", "ok: true"] },
  { path: "app/api/billing/checkout/route.ts", mustInclude: ["checkout.sessions.create", "organization_id", "guardOrgEndpoint"] },
  { path: "app/api/billing/portal/route.ts", mustInclude: ["billingPortal.sessions.create", "guardOrgEndpoint"] },
  { path: "app/api/keys/route.ts", mustInclude: ["requireAdmin", "Only organization owners or admins", "guardOrgEndpoint"] },
  { path: "app/api/v1/scan/route.ts", mustInclude: ["guardApiKeyEndpoint", "authenticateApiKey"] },
  { path: "app/api/v1/ranks/route.ts", mustInclude: ["guardApiKeyEndpoint"] },
  { path: "app/api/v1/export/route.ts", mustInclude: ["guardApiKeyEndpoint"] },
  { path: "app/api/trends/route.ts", mustInclude: ["guardPublicEndpoint", "apiUnauthorized"] },
  { path: "app/api/traffic-panel/beacon/route.ts", mustInclude: ["TRAFFIC_PANEL_INGEST_SECRET"] },
  { path: "app/api/projects/[id]/trust/route.ts", mustInclude: ["describeProviders", "verifyProjectAccess"] },
  { path: "app/api/public/audit/route.ts", mustInclude: ["guardPublicEndpoint"] },
  { path: "app/api/webhooks/stripe/route.ts", mustInclude: ["checkout.session.completed"] },
  { path: "app/api/attribution/sync/route.ts", mustInclude: ["verifyProjectAccess"] },
  { path: "app/api/leads/convert/route.ts", mustInclude: ["organization_id"] },
  {
    path: "app/api/projects/[id]/report/route.ts",
    // status: "failed" on the catch path guards against the orphaned-row
    // regression where a null gatherReportData() result (or any thrown
    // error) left the row stuck at pending/generating forever while the
    // response still claimed "ready". idempotency_key must both be read
    // from the request AND persisted on insert — a double-clicked Generate
    // button must reuse the existing report instead of creating (and
    // re-billing) a duplicate.
    mustInclude: [
      "getReportPreset",
      "canUseDeepReport",
      "guardOrgEndpoint",
      "validateBody",
      'status: "failed"',
      "idempotencyKey",
      "idempotent: true",
    ],
  },
  { path: "app/api/projects/[id]/scan/route.ts", mustInclude: ["guardOrgEndpoint", "verifyProjectAccess"] },
  {
    path: "app/api/projects/[id]/rescan/route.ts",
    // Two protections against a double-clicked Rescan button: an atomic
    // status != "scanning" claim (works even without a key) and the
    // idempotency_key threaded through to triggerProjectScan for the
    // already-in-flight-row case.
    mustInclude: ['neq("status", "scanning")', "idempotencyKey: parsed.data.idempotency_key"],
  },
  {
    path: "app/api/projects/[id]/report/[reportId]/cancel/route.ts",
    // Cancellation must gate on the in-flight statuses only — a ready/failed
    // report is a completed job and cancel is a no-op idempotent read, never
    // a status flip. .in("status", ["pending", "generating"]) on the update
    // (not just the initial select) also closes the race where the row
    // finishes between the read and the write.
    mustInclude: ['verifyProjectAccess', '"cancelling"', 'cancel_requested_at', 'in("status", ["pending", "generating"])'],
  },
  {
    path: "app/api/projects/[id]/scan/cancel/route.ts",
    mustInclude: ['verifyProjectAccess', '"cancelling"', 'cancel_requested_at', 'in("status", ["pending", "running"])'],
  },
  {
    path: "app/api/report/[token]/pdf/route.ts",
    // Public, token-gated route that can invoke a real Playwright render
    // (REPORT_PDF_TIMEOUT_MS, default 90s) on the legacy regeneration
    // fallback — without an explicit nodejs runtime + generous maxDuration,
    // a host's mismatched default can hard-cut the response mid-render.
    mustInclude: ['export const runtime = "nodejs"', "export const maxDuration ="],
  },
  { path: "app/api/capabilities/route.ts", mustInclude: ["describeProviders"] },
  { path: "app/api/keywords/route.ts", mustInclude: ["verifyProjectAccess"] },
  { path: "app/api/ranks/route.ts", mustInclude: ["verifyProjectAccess"] },
  { path: "app/api/backlinks/route.ts", mustInclude: ["verifyProjectAccess"] },
  { path: "app/api/roi/route.ts", mustInclude: ["verifyProjectAccess"] },
];

test("top API routes enforce auth, rate limits, or billing contracts", () => {
  for (const route of ROUTES) {
    const file = join(root, "src", route.path);
    assert.ok(existsSync(file), `missing route file ${route.path}`);
    const src = readFileSync(file, "utf8");
    for (const needle of route.mustInclude) {
      assert.ok(src.includes(needle), `${route.path} should include ${needle}`);
    }
  }
});
