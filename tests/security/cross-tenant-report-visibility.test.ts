import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch E: HTTP-level cross-tenant proof for PATCH
 * /api/projects/[id]/report/[reportId] — the "report visibility toggle"
 * route (flips `reports.is_public`, which gates whether the public
 * /api/report/[token]/pdf route will ever serve that report at all).
 *
 * This is a high-value target: if an Org A user could flip Org B's report to
 * `is_public: true`, they could then read it via the public share-token
 * route without ever needing Org B project access again. This file proves
 * that verifyProjectAccess blocks the toggle itself, and that the
 * service-role UPDATE is additionally scoped to `.eq("project_id", id)` so a
 * same-org, different-project IDOR can't flip a sibling project's report
 * either.
 */

interface ProjectRow {
  id: string;
  organization_id: string;
}

const projects: Record<string, ProjectRow> = {
  "proj-a": { id: "proj-a", organization_id: "org-a" },
  "proj-a2": { id: "proj-a2", organization_id: "org-a" },
  "proj-b": { id: "proj-b", organization_id: "org-b" },
};

const memberships: Record<string, Record<string, { role: string }>> = {
  "user-a": { "org-a": { role: "owner" } },
  "user-b": { "org-b": { role: "owner" } },
};

interface ReportRow {
  id: string;
  project_id: string;
  is_public: boolean;
  share_token: string;
}

const reports: Record<string, ReportRow> = {
  "report-a": { id: "report-a", project_id: "proj-a", is_public: true, share_token: "tok-a" },
  "report-a2": { id: "report-a2", project_id: "proj-a2", is_public: true, share_token: "tok-a2" },
  "report-b": { id: "report-b", project_id: "proj-b", is_public: true, share_token: "tok-b" },
};

interface State {
  userId: string | null;
  updateCalls: Array<{ reportId: string; projectId: string; payload: Record<string, unknown> }>;
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
    assert.equal(table, "reports");
    return {
      update: (payload: Record<string, unknown>) => ({
        eq: (_col: string, reportId: string) => ({
          eq: (_col2: string, projectId: string) => ({
            select: () => ({
              maybeSingle: async () => {
                state.updateCalls.push({ reportId, projectId, payload });
                const r = reports[reportId];
                const matches = r && r.project_id === projectId;
                if (matches) Object.assign(r!, payload);
                return {
                  data: matches ? { id: r!.id, is_public: r!.is_public, share_token: r!.share_token } : null,
                  error: null,
                };
              },
            }),
          }),
        }),
      }),
    };
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient, createServiceClient: async () => serviceClient },
});

const { PATCH } = await import("../../src/app/api/projects/[id]/report/[reportId]/route.ts");

function req(isPublic: boolean) {
  return new NextRequest("http://localhost/api/projects/x/report/y", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ is_public: isPublic }),
  });
}

test("cross-tenant: Org A user cannot toggle Org B's report visibility — 403, no UPDATE ever issued", async () => {
  resetState({ userId: "user-a" });
  const res = await PATCH(req(false), { params: Promise.resolve({ id: "proj-b", reportId: "report-b" }) });
  assert.equal(res.status, 403);
  assert.equal(state.updateCalls.length, 0, "denying visibility access must never reach the UPDATE");
  assert.equal(reports["report-b"].is_public, true, "Org B's report must remain untouched");
});

test("cross-tenant: Org B user cannot toggle Org A's report visibility — 403, no UPDATE ever issued", async () => {
  resetState({ userId: "user-b" });
  const res = await PATCH(req(false), { params: Promise.resolve({ id: "proj-a", reportId: "report-a" }) });
  assert.equal(res.status, 403);
  assert.equal(state.updateCalls.length, 0);
});

test("same-org IDOR: Org A user with access to proj-a cannot toggle proj-a2's report by naming proj-a in the URL", async () => {
  resetState({ userId: "user-a" });
  const res = await PATCH(req(false), { params: Promise.resolve({ id: "proj-a", reportId: "report-a2" }) });
  assert.equal(res.status, 404);
  assert.equal(reports["report-a2"].is_public, true, "a sibling project's report must remain untouched");
});

test("cross-tenant control case: Org A user CAN toggle their own project's report visibility", async () => {
  resetState({ userId: "user-a" });
  const res = await PATCH(req(false), { params: Promise.resolve({ id: "proj-a", reportId: "report-a" }) });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.is_public, false);
  assert.equal(reports["report-a"].is_public, false);
  reports["report-a"].is_public = true; // restore for subsequent tests
});

test("cross-tenant: unauthenticated request is rejected before any lookup", async () => {
  resetState({ userId: null });
  const res = await PATCH(req(false), { params: Promise.resolve({ id: "proj-b", reportId: "report-b" }) });
  assert.equal(res.status, 401);
  assert.equal(state.updateCalls.length, 0);
});
