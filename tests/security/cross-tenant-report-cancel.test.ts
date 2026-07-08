import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch E: HTTP-level cross-tenant proof for POST
 * /api/projects/[id]/report/[reportId]/cancel.
 *
 * report-cancel-route.test.ts (src/app/api/__tests__/) already pins the
 * single-tenant status-transition contract (pending/generating -> cancelling,
 * terminal states are no-ops, race-loss reports not_cancelled). This file
 * proves the tenant-isolation property specifically: a real, authenticated
 * user who legitimately belongs to Org A cannot cancel Org B's report by
 * guessing/reusing IDs, and cannot cancel a report that belongs to a
 * DIFFERENT project than the one named in the URL even within their own org
 * (an IDOR via a mismatched {id}/{reportId} pair). No mocked table ever
 * returns cross-tenant data — the route's own `.eq("project_id", id)` filter
 * on the report lookup is what's under test.
 */

interface ProjectRow {
  id: string;
  organization_id: string;
}

interface ReportRow {
  id: string;
  project_id: string;
  status: string;
}

// Two independent orgs, each with their own project + in-flight report, plus
// a second project inside Org A to exercise the same-org/different-project
// IDOR case.
const projects: Record<string, ProjectRow> = {
  "proj-a": { id: "proj-a", organization_id: "org-a" },
  "proj-a2": { id: "proj-a2", organization_id: "org-a" },
  "proj-b": { id: "proj-b", organization_id: "org-b" },
};

const memberships: Record<string, Record<string, { role: string }>> = {
  "user-a": { "org-a": { role: "owner" } },
  "user-b": { "org-b": { role: "owner" } },
};

const reports: Record<string, ReportRow> = {
  "report-a": { id: "report-a", project_id: "proj-a", status: "generating" },
  "report-a2": { id: "report-a2", project_id: "proj-a2", status: "generating" },
  "report-b": { id: "report-b", project_id: "proj-b", status: "generating" },
};

interface State {
  userId: string | null;
  updateCalls: Array<{ payload: Record<string, unknown>; reportId: string }>;
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

let lastReportId: string | null = null;

const serviceClient = {
  from: (table: string) => {
    assert.equal(table, "reports");
    return {
      select: () => ({
        eq: (_col: string, reportId: string) => {
          lastReportId = reportId;
          return {
            eq: (_col2: string, projectId: string) => ({
              // Mirrors the real query: report must match BOTH id and project_id.
              single: async () => {
                const r = reports[reportId];
                return { data: r && r.project_id === projectId ? r : null };
              },
            }),
          };
        },
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          in: () => {
            state.updateCalls.push({ payload, reportId: lastReportId! });
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

const { POST } = await import("../../src/app/api/projects/[id]/report/[reportId]/cancel/route.ts");

function req() {
  return new NextRequest("http://localhost/api/projects/x/report/y/cancel", { method: "POST" });
}

test("cross-tenant: Org A user cannot cancel Org B's report — 403 before any table write", async () => {
  resetState({ userId: "user-a" });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-b", reportId: "report-b" }) });
  assert.equal(res.status, 403);
  assert.equal(state.updateCalls.length, 0, "a cross-tenant request must never reach the UPDATE");
});

test("cross-tenant: Org B user cannot cancel Org A's report — 403 before any table write", async () => {
  resetState({ userId: "user-b" });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-a", reportId: "report-a" }) });
  assert.equal(res.status, 403);
  assert.equal(state.updateCalls.length, 0);
});

test("cross-tenant control case: Org A user CAN cancel their own project's report", async () => {
  resetState({ userId: "user-a" });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-a", reportId: "report-a" }) });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "cancelling");
  assert.equal(state.updateCalls.length, 1);
});

test("same-org IDOR: Org A user with access to proj-a cannot cancel proj-a2's report by naming proj-a in the URL", async () => {
  resetState({ userId: "user-a" });
  // User legitimately has access to proj-a (passes verifyProjectAccess), but
  // report-a2 actually belongs to proj-a2 — the service-role lookup filters
  // on BOTH id and project_id, so this must 404, not silently cancel a
  // report from a sibling project.
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-a", reportId: "report-a2" }) });
  assert.equal(res.status, 404);
  assert.equal(state.updateCalls.length, 0);
});

test("cross-tenant: unauthenticated request against any org's report is rejected before any lookup", async () => {
  resetState({ userId: null });
  const res = await POST(req(), { params: Promise.resolve({ id: "proj-b", reportId: "report-b" }) });
  assert.equal(res.status, 401);
  assert.equal(state.updateCalls.length, 0);
});
