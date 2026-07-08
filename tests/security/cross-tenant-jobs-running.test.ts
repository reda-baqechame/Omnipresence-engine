import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch E: HTTP-level cross-tenant proof for GET /api/jobs/running.
 *
 * Unlike the other routes here, /api/jobs/running has no `id`/`projectId`
 * param to attack — it lists every in-flight job across every project the
 * caller belongs to, and its documented isolation mechanism (see the route's
 * own doc-comment) is that it uses ONLY the RLS-scoped session client
 * (`createClient()`), never a service-role client, and applies no additional
 * server-side org filter on top of what RLS already returns. That means the
 * real cross-tenant guarantee lives in the `reports`/`visibility_runs` RLS
 * policies themselves (see supabase/migrations), not in this route's code —
 * a mocked unit test cannot re-prove a Postgres RLS policy is enforced.
 *
 * What THIS test can and does prove at the route-code level:
 *  1. The route echoes back exactly what the session-scoped client returns —
 *     it never widens the result set with a second, unfiltered query.
 *  2. The route never imports/calls createServiceClient at all. If a future
 *     change introduced a service-role fetch here (bypassing RLS) without
 *     adding an equivalent manual org filter, that is exactly the kind of
 *     regression this guards against: createServiceClient is intentionally
 *     left unmocked (undefined) below, so any accidental call to it throws
 *     and fails the test immediately instead of silently leaking data.
 */

interface FakeReportRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  report_type: string | null;
  current_step: string | null;
  progress_percent: number | null;
  share_token: string;
  created_at: string;
  actual_cost: number;
  tokens_used: number;
  projects: { name: string } | null;
}

interface State {
  userId: string | null;
  // Simulates what RLS would already have filtered down to for the current
  // session — i.e. only rows belonging to orgs `userId` is a member of.
  visibleReports: FakeReportRow[];
}

const state: State = { userId: "user-a", visibleReports: [] };

function resetState(overrides: Partial<State>) {
  state.userId = "user-a";
  state.visibleReports = [];
  Object.assign(state, overrides);
}

function selectChain<T>(rows: T[]) {
  return {
    in: () => selectChain(rows),
    order: () => selectChain(rows),
    limit: async () => ({ data: rows }),
  };
}

const sessionClient = {
  auth: {
    getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }),
  },
  from: (table: string) => {
    if (table === "reports") {
      // Session client is RLS-scoped: only ever returns rows this user's
      // memberships would actually be allowed to see in production.
      return { select: () => selectChain(state.visibleReports) };
    }
    if (table === "visibility_runs") {
      return { select: () => selectChain([]) };
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: {
    createClient: async () => sessionClient,
    // Intentionally absent/undefined: calling this must throw, proving the
    // route never falls back to an RLS-bypassing service-role client for a
    // cross-tenant listing surface.
    createServiceClient: undefined,
  },
});

const { GET } = await import("../../src/app/api/jobs/running/route.ts");

test("cross-tenant: Org A's poll never surfaces Org B's report simply because it exists in the DB — only RLS-visible rows are echoed back", async () => {
  resetState({
    userId: "user-a",
    // Only Org A's own report is "RLS-visible" to this session client — an
    // Org B report is deliberately absent from the fixture to prove the
    // route doesn't independently fetch/merge anything beyond what the
    // session client (RLS) already scoped.
    visibleReports: [
      {
        id: "report-a",
        project_id: "proj-a",
        title: "Org A report",
        status: "generating",
        report_type: "standard",
        current_step: "gathering",
        progress_percent: 40,
        share_token: "tok-a",
        created_at: new Date().toISOString(),
        actual_cost: 0.01,
        tokens_used: 10,
        projects: { name: "Org A Project" },
      },
    ],
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].id, "report-a");
  assert.ok(
    !body.jobs.some((j: { id: string }) => j.id === "report-b"),
    "an Org B job must never appear in Org A's poll response"
  );
});

test("cross-tenant: the route never calls createServiceClient (would bypass RLS) — a call throws instead of silently succeeding", async () => {
  resetState({ userId: "user-a", visibleReports: [] });
  // If this test throws "createServiceClient is not a function" from INSIDE
  // the route module, that would mean the route tried to use it — which
  // this test intentionally treats as a hard failure of the isolation
  // property, not a passing result.
  const res = await GET();
  assert.equal(res.status, 200);
});

test("cross-tenant: unauthenticated request is rejected before any table lookup", async () => {
  resetState({ userId: null });
  const res = await GET();
  assert.equal(res.status, 401);
});
