import { test, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * P1 fix (hostile-audit punch list item #7, "per-job cost/tokens"): the
 * running-jobs strip is the ONE surface every authenticated user sees on
 * every page — if it silently omits or misreports real attributed spend
 * (reports.actual_cost / visibility_runs.actual_cost, rolled up by
 * cost-guard.ts's increment_report_usage / increment_run_usage RPCs) users
 * have no idea what an in-flight job is costing them. This behavioral test
 * drives the real GET handler against a mocked Supabase client and asserts
 * the response actually carries actualCost/tokensUsed through for both
 * report and scan jobs.
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
  // NUMERIC(12,6) columns come back as strings from real PostgREST — the
  // fake rows below intentionally use strings for actual_cost to pin the
  // route's Number(...) coercion, not just the happy-path numeric case.
  actual_cost: string | number | null;
  tokens_used: number | null;
  projects: { name: string } | null;
}

interface FakeRunRow {
  id: string;
  project_id: string;
  status: string;
  current_step: string | null;
  progress_percent: number | null;
  started_at: string | null;
  actual_cost: string | number | null;
  tokens_used: number | null;
  projects: { name: string } | null;
}

interface State {
  userId: string | null;
  reports: FakeReportRow[];
  runs: FakeRunRow[];
}

const state: State = { userId: "user-1", reports: [], runs: [] };

function resetState(overrides: Partial<State>) {
  state.userId = "user-1";
  state.reports = [];
  state.runs = [];
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
      return { select: () => selectChain(state.reports) };
    }
    if (table === "visibility_runs") {
      return { select: () => selectChain(state.runs) };
    }
    throw new Error(`unexpected table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient },
});

const { GET } = await import("../jobs/running/route.ts");

test("running jobs route: unauthenticated request is rejected", async () => {
  resetState({ userId: null });
  const res = await GET();
  assert.equal(res.status, 401);
});

test("running jobs route: a report with real attributed spend carries actualCost/tokensUsed through to the response, coercing PostgREST's stringified NUMERIC", async () => {
  resetState({
    reports: [
      {
        id: "report-1",
        project_id: "proj-1",
        title: "Deep report",
        status: "generating",
        report_type: "deep",
        current_step: "gathering-evidence",
        progress_percent: 40,
        share_token: "tok-1",
        created_at: new Date().toISOString(),
        actual_cost: "0.034200", // real NUMERIC(12,6) over PostgREST is a string
        tokens_used: 4200,
        projects: { name: "Acme" },
      },
    ],
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].kind, "report");
  assert.equal(typeof body.jobs[0].actualCost, "number", "must coerce the NUMERIC string to a real number");
  assert.equal(body.jobs[0].actualCost, 0.0342);
  assert.equal(body.jobs[0].tokensUsed, 4200);
});

test("running jobs route: a job with no tracked spend yet reports honest zeros, never null/undefined", async () => {
  resetState({
    runs: [
      {
        id: "run-1",
        project_id: "proj-1",
        status: "running",
        current_step: null,
        progress_percent: null,
        started_at: new Date().toISOString(),
        actual_cost: null,
        tokens_used: null,
        projects: { name: "Acme" },
      },
    ],
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].kind, "scan");
  assert.equal(body.jobs[0].actualCost, 0);
  assert.equal(body.jobs[0].tokensUsed, 0);
});

test("running jobs route: combines report and scan jobs in one response", async () => {
  resetState({
    reports: [
      {
        id: "report-1",
        project_id: "proj-1",
        title: "Report",
        status: "pending",
        report_type: "standard",
        current_step: null,
        progress_percent: null,
        share_token: "tok-1",
        created_at: new Date().toISOString(),
        actual_cost: 0.01,
        tokens_used: 100,
        projects: { name: "Acme" },
      },
    ],
    runs: [
      {
        id: "run-1",
        project_id: "proj-1",
        status: "running",
        current_step: null,
        progress_percent: null,
        started_at: new Date().toISOString(),
        actual_cost: 0.02,
        tokens_used: 200,
        projects: { name: "Acme" },
      },
    ],
  });
  const res = await GET();
  const body = await res.json();
  assert.equal(body.jobs.length, 2);
  const kinds = body.jobs.map((j: { kind: string }) => j.kind).sort();
  assert.deepEqual(kinds, ["report", "scan"]);
});
