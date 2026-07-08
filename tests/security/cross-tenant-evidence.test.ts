import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * Patch E: HTTP-level cross-tenant proof for GET /api/evidence.
 * evidence-route.test.ts (src/app/api/__tests__/) already pins the response
 * field parity (confidence/trace_id/captured_at). This file proves the
 * tenant-isolation property: an Org A user cannot read Org B's
 * measurement_evidence / ai_capture_evidence rows by supplying Org B's
 * projectId in the query string, even though the route takes projectId as a
 * plain (unsigned) query param rather than a path segment.
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
  "user-a": { "org-a": { role: "member" } },
  "user-b": { "org-b": { role: "member" } },
};

// If the route ever failed to gate on verifyProjectAccess, these rows would
// leak across tenants — the test asserts the evidence tables are never even
// queried for a rejected cross-tenant request.
const evidenceRowsByProject: Record<string, Array<{ id: string; capability: string; target: string }>> = {
  "proj-a": [{ id: "meas-a", capability: "rank", target: "org-a-secret-keyword" }],
  "proj-b": [{ id: "meas-b", capability: "rank", target: "org-b-secret-keyword" }],
};

interface State {
  userId: string | null;
  evidenceTableTouched: boolean;
}

const state: State = { userId: null, evidenceTableTouched: false };

function resetState(overrides: Partial<State>) {
  state.userId = null;
  state.evidenceTableTouched = false;
  Object.assign(state, overrides);
}

function evidenceChain(rows: unknown[]) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    ilike() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    then(resolve: (v: { data: unknown[] }) => void) {
      resolve({ data: rows });
    },
  };
  return chain;
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
    if (table === "measurement_evidence") {
      state.evidenceTableTouched = true;
      // Deliberately always resolve to Org B's rows regardless of which
      // projectId is passed in this fixture — if the route's access-check
      // gate is bypassed for a cross-tenant request, this proves it by
      // leaking Org B data to Org A's request, which the tests assert never
      // happens (request is rejected with 403 before this branch runs).
      return evidenceChain(evidenceRowsByProject["proj-b"]);
    }
    if (table === "ai_capture_evidence") {
      state.evidenceTableTouched = true;
      return evidenceChain([]);
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient },
});

const { GET } = await import("../../src/app/api/evidence/route.ts");

function req(projectId: string) {
  return new NextRequest(`http://localhost/api/evidence?projectId=${projectId}&capability=rank`);
}

test("cross-tenant: Org A user cannot read Org B's evidence via projectId query param — 403, no table touched", async () => {
  resetState({ userId: "user-a" });
  const res = await GET(req("proj-b"));
  assert.equal(res.status, 403);
  assert.equal(state.evidenceTableTouched, false, "evidence tables must never be queried for a rejected cross-tenant request");
});

test("cross-tenant: Org B user cannot read Org A's evidence via projectId query param — 403, no table touched", async () => {
  resetState({ userId: "user-b" });
  const res = await GET(req("proj-a"));
  assert.equal(res.status, 403);
  assert.equal(state.evidenceTableTouched, false);
});

test("cross-tenant control case: Org B user CAN read their own project's evidence", async () => {
  resetState({ userId: "user-b" });
  const res = await GET(req("proj-b"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.measurement[0].target, "org-b-secret-keyword");
});

test("cross-tenant: unauthenticated request is rejected before any table lookup", async () => {
  resetState({ userId: null });
  const res = await GET(req("proj-b"));
  assert.equal(res.status, 401);
  assert.equal(state.evidenceTableTouched, false);
});
