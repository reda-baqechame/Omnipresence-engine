import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Patch E: HTTP-level cross-tenant proof for GET /api/projects/[id]/trust
 * (the Data Trust Center). trust-route.test.ts (src/app/api/__tests__/)
 * already pins the missing-vs-active provider labeling contract. This file
 * proves the tenant-isolation property: an Org A user cannot read Org B's
 * Data Trust Center (scores, data-quality, visibility signals, attribution,
 * GSC status) by naming Org B's project id in the URL.
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

interface State {
  userId: string | null;
  scoresTableTouched: boolean;
}

const state: State = { userId: null, scoresTableTouched: false };

function resetState(overrides: Partial<State>) {
  state.userId = null;
  state.scoresTableTouched = false;
  Object.assign(state, overrides);
}

function nullChain() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: null }),
    single: async () => ({ data: null }),
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
    // scores, data_quality_scores, visibility_results, rank_keywords,
    // attribution_metrics, gsc_snapshots — mark touched so we can assert
    // none of these are queried for a rejected cross-tenant request.
    state.scoresTableTouched = true;
    return nullChain();
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient },
});

mock.module("@/lib/config/capabilities", {
  namedExports: {
    getCapabilitiesSummary: () => ({ liveData: true, activeSerpProvider: "serper", configuredCount: 2 }),
  },
});

mock.module("@/lib/providers/router", {
  namedExports: {
    describeProviders: async () => [],
  },
});

const { GET } = await import("../../src/app/api/projects/[id]/trust/route.ts");

function req() {
  return new Request("http://localhost/api/projects/x/trust");
}

test("cross-tenant: Org A user cannot read Org B's Data Trust Center — 403, no data tables touched", async () => {
  resetState({ userId: "user-a" });
  const res = await GET(req(), { params: Promise.resolve({ id: "proj-b" }) });
  assert.equal(res.status, 403);
  assert.equal(state.scoresTableTouched, false, "no data table should ever be queried for a rejected cross-tenant request");
});

test("cross-tenant: Org B user cannot read Org A's Data Trust Center — 403, no data tables touched", async () => {
  resetState({ userId: "user-b" });
  const res = await GET(req(), { params: Promise.resolve({ id: "proj-a" }) });
  assert.equal(res.status, 403);
  assert.equal(state.scoresTableTouched, false);
});

test("cross-tenant control case: Org A user CAN read their own project's Data Trust Center", async () => {
  resetState({ userId: "user-a" });
  const res = await GET(req(), { params: Promise.resolve({ id: "proj-a" }) });
  assert.equal(res.status, 200);
  assert.equal(state.scoresTableTouched, true);
});

test("cross-tenant: unauthenticated request is rejected before any lookup", async () => {
  resetState({ userId: null });
  const res = await GET(req(), { params: Promise.resolve({ id: "proj-b" }) });
  assert.equal(res.status, 401);
  assert.equal(state.scoresTableTouched, false);
});
