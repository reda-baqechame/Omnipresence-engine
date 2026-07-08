import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * P2 fix ("Data Health panel - ... note missing sources honestly"): the
 * Data Trust Center previously only ever returned `activeProviders` —
 * providers that are registered but NOT currently usable (missing API key,
 * disabled in zero-paid-keys mode, benchmark-only) were silently dropped,
 * so a user had no way to see what data sources exist but aren't wired up.
 *
 * This behavioral test drives the real GET handler against a mocked
 * Supabase client + a mocked describeProviders() and asserts the response
 * actually carries a `missingProviders` list with a human-readable reason
 * per entry, not just the happy-path `activeProviders`.
 */

interface State {
  userId: string | null;
  project: { id: string; organization_id: string } | null;
  membership: { role: string } | null;
}

const state: State = {
  userId: "user-1",
  project: { id: "proj-1", organization_id: "org-1" },
  membership: { role: "member" },
};

function resetState(overrides: Partial<State>) {
  state.userId = "user-1";
  state.project = { id: "proj-1", organization_id: "org-1" };
  state.membership = { role: "member" };
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
      return { select: () => ({ eq: () => ({ single: async () => ({ data: state.project }) }) }) };
    }
    if (table === "memberships") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: state.membership }) }) }) }),
      };
    }
    // scores, data_quality_scores, visibility_results, rank_keywords,
    // attribution_metrics, gsc_snapshots — none exercised by these
    // assertions, so a chain that resolves to "no data" everywhere is fine.
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

const providersState: { providers: Array<Record<string, unknown>> } = { providers: [] };

mock.module("@/lib/providers/router", {
  namedExports: {
    describeProviders: async () => providersState.providers,
  },
});

const { GET } = await import("../projects/[id]/trust/route.ts");

function req() {
  return new Request("http://localhost/api/projects/proj-1/trust");
}

test("trust route: unauthenticated request is rejected", async () => {
  resetState({ userId: null });
  const res = await GET(req(), { params: Promise.resolve({ id: "proj-1" }) });
  assert.equal(res.status, 401);
});

test("trust route: a user without project access is rejected", async () => {
  resetState({ membership: null });
  const res = await GET(req(), { params: Promise.resolve({ id: "proj-1" }) });
  assert.equal(res.status, 403);
});

test("trust route: honestly lists missing providers with a human-readable reason, separate from active ones", async () => {
  resetState({});
  providersState.providers = [
    { id: "dataforseo-serp", capability: "search_visibility", category: "live", paid: true, enabled: true, usableNow: true, confidence: 0.9, circuit: "closed" },
    { id: "ahrefs", capability: "authority_mentions", category: "live", paid: true, enabled: false, usableNow: false },
    { id: "google-my-business", capability: "local_visibility", category: "live", paid: false, enabled: false, usableNow: false },
    { id: "moz-benchmark", capability: "authority_mentions", category: "benchmark_only", paid: false, enabled: true, usableNow: false },
    { id: "brave-search", capability: "search_visibility", category: "live", paid: false, enabled: true, usableNow: false },
  ];

  const res = await GET(req(), { params: Promise.resolve({ id: "proj-1" }) });
  const body = await res.json();
  assert.equal(res.status, 200);

  assert.equal(body.activeProviders.length, 1);
  assert.equal(body.activeProviders[0].id, "dataforseo-serp");

  assert.equal(body.missingProviders.length, 4);
  const byId = Object.fromEntries(body.missingProviders.map((p: { id: string; reason: string }) => [p.id, p.reason]));
  assert.equal(byId["ahrefs"], "Paid provider — API key not configured");
  assert.equal(byId["google-my-business"], "Not configured");
  assert.equal(byId["moz-benchmark"], "Benchmark-only — never used for live results");
  assert.equal(byId["brave-search"], "Disabled in Zero-Paid-Keys mode");
});

test("trust route: no missing providers yields an empty (not omitted) missingProviders array", async () => {
  resetState({});
  providersState.providers = [
    { id: "dataforseo-serp", capability: "search_visibility", category: "live", paid: true, enabled: true, usableNow: true, confidence: 0.9, circuit: "closed" },
  ];

  const res = await GET(req(), { params: Promise.resolve({ id: "proj-1" }) });
  const body = await res.json();
  assert.deepEqual(body.missingProviders, []);
});
