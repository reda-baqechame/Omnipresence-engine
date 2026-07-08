import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * P1 fix (hostile-audit punch list item #5, "theater tests"):
 * routes-contract.test.ts previously pinned this route's cancellation
 * contract by grepping its SOURCE TEXT for string presence (e.g.
 * `in("status", ["pending", "generating"])` appears somewhere in the file).
 * That proves the string exists, not that the route actually behaves
 * correctly — e.g. it wouldn't catch a bug where the .in(...) guard was
 * present on the SELECT but accidentally dropped from the UPDATE (the exact
 * race the guard exists to close).
 *
 * These call the real exported POST handler against a mocked Supabase
 * layer and assert on the actual HTTP response for each report status.
 *
 * The mock is registered ONCE (mock.module() + the route module are both
 * singletons for this file/process — node --test isolates files into
 * separate processes, but re-mocking the same specifier or re-importing an
 * already-cached consumer module mid-file doesn't rebind it). Each test
 * instead reconfigures the shared `state` object the mocked
 * createClient/createServiceClient close over, so route.ts's own top-level
 * imports (bound once, at first import) stay pointed at live, swappable
 * behavior.
 */

interface State {
  userId: string | null;
  project: { id: string; organization_id: string } | null;
  membership: { role: string } | null;
  report: { id: string; project_id: string; status: string } | null;
  updateSucceeds: boolean;
  updateCalls: Array<{ payload: Record<string, unknown>; statusFilter: string[] }>;
}

const state: State = {
  userId: "user-1",
  project: { id: "proj-1", organization_id: "org-1" },
  membership: { role: "member" },
  report: null,
  updateSucceeds: true,
  updateCalls: [],
};

function resetState(overrides: Partial<State>) {
  state.userId = "user-1";
  state.project = { id: "proj-1", organization_id: "org-1" };
  state.membership = { role: "member" };
  state.report = null;
  state.updateSucceeds = true;
  state.updateCalls = [];
  Object.assign(state, overrides);
}

const sessionClient = {
  auth: {
    getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }),
  },
  from: (table: string) => {
    if (table === "projects") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: state.project }) }) }) };
    }
    if (table === "memberships") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: state.membership }) }) }) }),
      };
    }
    throw new Error(`unexpected table on session client: ${table}`);
  },
};

const serviceClient = {
  from: (table: string) => {
    assert.equal(table, "reports");
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: state.report }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          in: (_col: string, statuses: string[]) => {
            state.updateCalls.push({ payload, statusFilter: statuses });
            return {
              select: () => ({
                single: async () =>
                  state.updateSucceeds
                    ? { data: { status: payload.status }, error: null }
                    : { data: null, error: { message: "no rows" } },
              }),
            };
          },
        }),
      }),
    };
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient, createServiceClient: async () => serviceClient },
});

const { POST } = await import("../projects/[id]/report/[reportId]/cancel/route.ts");

function req() {
  return new NextRequest("http://localhost/api/projects/proj-1/report/report-1/cancel", { method: "POST" });
}

test("report cancel route: unauthenticated request is rejected before touching any table", async () => {
  resetState({ userId: null });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  assert.equal(res.status, 401);
});

test("report cancel route: a 'generating' report is flipped to cancelling with cancel_requested_at set, and the UPDATE itself re-gates on in-flight statuses", async () => {
  resetState({ report: { id: "report-1", project_id: "proj-1", status: "generating" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, "cancelling");
  assert.equal(state.updateCalls.length, 1);
  assert.equal(state.updateCalls[0].payload.status, "cancelling");
  assert.ok(state.updateCalls[0].payload.cancel_requested_at, "cancel_requested_at must be set");
  assert.deepEqual(
    state.updateCalls[0].statusFilter,
    ["pending", "generating"],
    "the UPDATE itself must re-gate on in-flight statuses, not just the initial SELECT"
  );
});

test("report cancel route: a 'pending' report is also cancellable", async () => {
  resetState({ report: { id: "report-1", project_id: "proj-1", status: "pending" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  const body = await res.json();
  assert.equal(body.status, "cancelling");
});

test("report cancel route: a 'ready' report is never flipped — idempotent no-op returning its real terminal status", async () => {
  resetState({ report: { id: "report-1", project_id: "proj-1", status: "ready" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, "ready", "must return the report's real terminal status, never fabricate cancelling");
  assert.equal(state.updateCalls.length, 0, "a completed job must never be written to");
});

test("report cancel route: a 'failed' report is also never flipped", async () => {
  resetState({ report: { id: "report-1", project_id: "proj-1", status: "failed" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  const body = await res.json();
  assert.equal(body.status, "failed");
  assert.equal(state.updateCalls.length, 0);
});

test("report cancel route: report not found returns 404", async () => {
  resetState({ report: null });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  assert.equal(res.status, 404);
});

test("report cancel route: loses the race to a concurrent completion — the atomic UPDATE rejects and the route reports not_cancelled, never a false success", async () => {
  resetState({
    report: { id: "report-1", project_id: "proj-1", status: "generating" },
    updateSucceeds: false, // simulates the report finishing between the SELECT read and this UPDATE
  });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  const body = await res.json();
  assert.equal(body.status, "not_cancelled");
});

test("report cancel route: a viewer (below 'member') is forbidden", async () => {
  resetState({
    membership: { role: "viewer" },
    report: { id: "report-1", project_id: "proj-1", status: "generating" },
  });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1", reportId: "report-1" }) });
  assert.equal(res.status, 403);
});
