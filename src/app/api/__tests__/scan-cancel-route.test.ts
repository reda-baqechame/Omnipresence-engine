import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * P1 fix (hostile-audit punch list item #5, "theater tests") — see
 * report-cancel-route.test.ts for the full rationale and the shared-state
 * mock pattern this mirrors. Lives at this flat location (not colocated
 * under app/api/projects/[id]/scan/cancel/__tests__/) because node --test's
 * file-glob discovery treats `[...]` path segments as character classes and
 * silently matches zero files.
 */

interface State {
  userId: string | null;
  project: { id: string; organization_id: string } | null;
  membership: { role: string } | null;
  activeRun: { id: string; status: string } | null;
  updateSucceeds: boolean;
  updateCalls: Array<{ payload: Record<string, unknown>; statusFilter: string[] }>;
}

const state: State = {
  userId: "user-1",
  project: { id: "proj-1", organization_id: "org-1" },
  membership: { role: "member" },
  activeRun: null,
  updateSucceeds: true,
  updateCalls: [],
};

function resetState(overrides: Partial<State>) {
  state.userId = "user-1";
  state.project = { id: "proj-1", organization_id: "org-1" };
  state.membership = { role: "member" };
  state.activeRun = null;
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
    assert.equal(table, "visibility_runs");
    return {
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: state.activeRun }),
              }),
            }),
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

const { POST } = await import("../projects/[id]/scan/cancel/route.ts");

function req() {
  return new NextRequest("http://localhost/api/projects/proj-1/scan/cancel", { method: "POST" });
}

test("scan cancel route: unauthenticated request is rejected before touching any table", async () => {
  resetState({ userId: null });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1" }) });
  assert.equal(res.status, 401);
});

test("scan cancel route: a 'running' visibility_run is flipped to cancelling with cancel_requested_at set, re-gating the UPDATE on in-flight statuses", async () => {
  resetState({ activeRun: { id: "run-1", status: "running" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1" }) });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, "cancelling");
  assert.equal(state.updateCalls.length, 1);
  assert.equal(state.updateCalls[0].payload.status, "cancelling");
  assert.ok(state.updateCalls[0].payload.cancel_requested_at);
  assert.deepEqual(
    state.updateCalls[0].statusFilter,
    ["pending", "running"],
    "the UPDATE itself must re-gate on in-flight statuses, not just the initial SELECT"
  );
});

test("scan cancel route: a 'pending' visibility_run is also cancellable", async () => {
  resetState({ activeRun: { id: "run-1", status: "pending" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1" }) });
  const body = await res.json();
  assert.equal(body.status, "cancelling");
});

test("scan cancel route: no active run returns 404 (no completed/failed run is ever touched)", async () => {
  resetState({ activeRun: null });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1" }) });
  assert.equal(res.status, 404);
  assert.equal(state.updateCalls.length, 0);
});

test("scan cancel route: loses the race to a concurrent completion — reports not_cancelled, never a false success", async () => {
  resetState({ activeRun: { id: "run-1", status: "running" }, updateSucceeds: false });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1" }) });
  const body = await res.json();
  assert.equal(body.status, "not_cancelled");
});

test("scan cancel route: a viewer (below 'member') is forbidden", async () => {
  resetState({ membership: { role: "viewer" }, activeRun: { id: "run-1", status: "running" } });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-1" }) });
  assert.equal(res.status, 403);
});
