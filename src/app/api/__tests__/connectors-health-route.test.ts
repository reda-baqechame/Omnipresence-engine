import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch I: GET /api/connectors/health stays a cheap, DB-only read by default,
 * and only fetches live GSC/GA4/Bing numbers (via first-party-analytics.ts)
 * when the caller opts in with ?includeSnapshots=true. This pins both the
 * default behavior (no live calls, no `snapshots` key at all) and the opt-in
 * behavior (real snapshot functions invoked with the project's domain, null
 * passed straight through when a source isn't connected).
 */

let userId: string | null = "user-1";
let projectAccessResult: unknown = { organizationId: "org-1", role: "viewer" };
let projectRow: { domain?: string } | null = { domain: "example.com" };

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
      from: (table: string) => {
        assert.equal(table, "projects");
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: projectRow }),
            }),
          }),
        };
      },
    }),
  },
});

mock.module("@/lib/security/project-access", {
  namedExports: {
    verifyProjectAccess: async () => projectAccessResult,
  },
});

let connectorHealthCalls = 0;
mock.module("@/lib/engines/connector-health", {
  namedExports: {
    getConnectorHealth: async () => {
      connectorHealthCalls++;
      return { projectId: "proj-1", connectors: [], connectedCount: 0, healthyCount: 0, outcomeGuaranteeEligible: false, hasAnyConnection: false, reason: "none" };
    },
  },
});

const snapshotCalls: { gsc: number; ga4: number; bing: number } = { gsc: 0, ga4: 0, bing: 0 };
mock.module("@/lib/providers/first-party-analytics", {
  namedExports: {
    getSearchConsoleSnapshot: async () => {
      snapshotCalls.gsc++;
      return { clicks: 10, impressions: 100, ctr: 0.1, position: 5, periodStart: "2026-01-01", periodEnd: "2026-01-28" };
    },
    getGa4Snapshot: async () => {
      snapshotCalls.ga4++;
      return null;
    },
    getBingWebmasterSnapshot: async () => {
      snapshotCalls.bing++;
      return { clicks: 3, impressions: 40, aiCitations: 0, periodStart: "2026-01-01", periodEnd: "2026-01-28" };
    },
  },
});

const { GET } = await import("../connectors/health/route.ts");

function req(query = "") {
  return new NextRequest(`http://localhost/api/connectors/health?projectId=proj-1${query}`);
}

test("connectors/health: unauthenticated request is rejected", async () => {
  userId = null;
  const res = await GET(req());
  assert.equal(res.status, 401);
  userId = "user-1";
});

test("connectors/health: missing projectId is rejected before any DB call", async () => {
  const res = await GET(new NextRequest("http://localhost/api/connectors/health"));
  assert.equal(res.status, 400);
});

test("connectors/health: a user without project access is rejected", async () => {
  projectAccessResult = null;
  const res = await GET(req());
  assert.equal(res.status, 403);
  projectAccessResult = { organizationId: "org-1", role: "viewer" };
});

test("connectors/health: by default, no live snapshot calls are made and the response has no snapshots key", async () => {
  snapshotCalls.gsc = snapshotCalls.ga4 = snapshotCalls.bing = 0;
  connectorHealthCalls = 0;
  const res = await GET(req());
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(connectorHealthCalls, 1);
  assert.equal(snapshotCalls.gsc, 0);
  assert.equal(snapshotCalls.ga4, 0);
  assert.equal(snapshotCalls.bing, 0);
  assert.equal("snapshots" in body, false, "must not add a snapshots key unless explicitly requested");
});

test("connectors/health: includeSnapshots=true fetches all three live snapshots and passes nulls through honestly", async () => {
  snapshotCalls.gsc = snapshotCalls.ga4 = snapshotCalls.bing = 0;
  const res = await GET(req("&includeSnapshots=true"));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(snapshotCalls.gsc, 1);
  assert.equal(snapshotCalls.ga4, 1);
  assert.equal(snapshotCalls.bing, 1);
  assert.equal(body.snapshots.google_search_console.clicks, 10);
  assert.equal(body.snapshots.google_analytics, null, "an unconnected/unconfigured source must stay null, not be omitted or zeroed");
  assert.equal(body.snapshots.bing_webmaster.clicks, 3);
});

test("connectors/health: includeSnapshots=true with no project domain skips GSC/Bing (no domain to query) but still checks GA4", async () => {
  projectRow = null;
  snapshotCalls.gsc = snapshotCalls.ga4 = snapshotCalls.bing = 0;
  const res = await GET(req("&includeSnapshots=true"));
  const body = await res.json();
  assert.equal(snapshotCalls.gsc, 0, "no domain means GSC snapshot must not even be attempted");
  assert.equal(snapshotCalls.bing, 0, "no domain means Bing snapshot must not even be attempted");
  assert.equal(snapshotCalls.ga4, 1, "GA4 doesn't need the domain, only the OAuth connection");
  assert.equal(body.snapshots.google_search_console, null);
  assert.equal(body.snapshots.bing_webmaster, null);
  projectRow = { domain: "example.com" };
});
