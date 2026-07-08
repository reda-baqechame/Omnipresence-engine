import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch E: HTTP-level cross-tenant proof for POST /api/projects/[id]/scan/cancel.
 * Mirrors cross-tenant-report-cancel.test.ts: verifyProjectAccess is the only
 * gate here (there is no reportId to mismatch), so the isolation property
 * under test is that an Org A user can never reach — let alone mutate —
 * Org B's active visibility_runs row, regardless of what project id they
 * supply, and that no write happens before that gate passes.
 */

interface ProjectRow {
  id: string;
  organization_id: string;
}

const projects: Record<string, ProjectRow> = {
  "proj-a": { id: "proj-a", organization_id: "org-a" },
  "proj-b": { id: "proj-b", organization_id: "org-b" },
};

const memberships: Record<string, Record<string, { role: string }>> = {
  "user-a": { "org-a": { role: "owner" } },
  "user-b": { "org-b": { role: "owner" } },
};

const activeRunsByProject: Record<string, { id: string; status: string } | null> = {
  "proj-a": { id: "run-a", status: "running" },
  "proj-b": { id: "run-b", status: "running" },
};

interface State {
  userId: string | null;
  updateCalls: Array<{ payload: Record<string, unknown> }>;
}

const state: State = { userId: null, updateCalls: [] };

function resetState(overrides: Partial<State>) {
  state.userId = null;
  state.updateCalls = [];
  Object.assign(state, overrides);
}

const sessionClient = {
  auth: {
    getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }),
  },
  from: (table: string) => {
    if (table === "projects") {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            single: async () => ({ data: projects[id] ?? null }),
          }),
        }),
      };
    }
    if (table === "memberships") {
      return {
        select: () => ({
          eq: (_col1: string, userId: string) => ({
            eq: (_col2: string, orgId: string) => ({
              single: async () => ({ data: memberships[userId]?.[orgId] ?? null }),
            }),
          }),
        }),
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
        eq: (_col: string, projectId: string) => ({
          in: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: activeRunsByProject[projectId] ?? null }),
              }),
            }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          in: () => {
            state.updateCalls.push({ payload });
            return {
              select: () => ({
                single: async () => ({ data: { status: payload.status }, error: null }),
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

const { POST } = await import("../../src/app/api/projects/[id]/scan/cancel/route.ts");

function req() {
  return new NextRequest("http://localhost/api/projects/x/scan/cancel", { method: "POST" });
}

test("cross-tenant: Org A user cannot cancel Org B's scan — 403 before any lookup or write", async () => {
  resetState({ userId: "user-a" });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-b" }) });
  assert.equal(res.status, 403);
  assert.equal(state.updateCalls.length, 0);
});

test("cross-tenant: Org B user cannot cancel Org A's scan — 403 before any lookup or write", async () => {
  resetState({ userId: "user-b" });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-a" }) });
  assert.equal(res.status, 403);
  assert.equal(state.updateCalls.length, 0);
});

test("cross-tenant control case: Org A user CAN cancel their own project's scan", async () => {
  resetState({ userId: "user-a" });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-a" }) });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "cancelling");
  assert.equal(state.updateCalls.length, 1);
});

test("cross-tenant: unauthenticated request is rejected before any lookup", async () => {
  resetState({ userId: null });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-b" }) });
  assert.equal(res.status, 401);
  assert.equal(state.updateCalls.length, 0);
});
