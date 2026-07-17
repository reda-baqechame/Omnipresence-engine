import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

/**
 * P1 fix ("basic report versioning, supersede relationship on regenerate"):
 * behavioral coverage for POST /api/projects/[id]/report's versioning logic
 * — each report links to the one it replaces via previous_report_id, scoped
 * per (project_id, report_type) so standard/deep lineages stay independent.
 */

interface ReportRow {
  id: string;
  project_id: string;
  report_type: string;
  version: number;
  previous_report_id: string | null;
  status: string;
  share_token: string;
}

const reportsStore = new Map<string, ReportRow>();
let counter = 0;

function findLatest(projectId: string, reportType: string): ReportRow | undefined {
  return [...reportsStore.values()]
    .filter((r) => r.project_id === projectId && r.report_type === reportType)
    .sort((a, b) => b.version - a.version)[0];
}

const reportsTable = {
  select: () => ({
    eq: (col1: string, val1: string) => ({
      eq: (col2: string, val2: string) => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => {
              const rows = [...reportsStore.values()].filter(
                (r) => (r as Record<string, unknown>)[col1] === val1 && (r as Record<string, unknown>)[col2] === val2
              );
              rows.sort((a, b) => b.version - a.version);
              return { data: rows[0] ?? null };
            },
          }),
        }),
      }),
    }),
  }),
  insert: (payload: Partial<ReportRow>) => ({
    select: () => ({
      single: async () => {
        const id = `report-${++counter}`;
        const row: ReportRow = {
          id,
          project_id: "",
          report_type: "standard",
          version: 1,
          previous_report_id: null,
          status: "generating",
          share_token: `tok-${id}`,
          ...payload,
        } as ReportRow;
        reportsStore.set(id, row);
        return { data: row, error: null };
      },
    }),
  }),
};

const sessionClient = {
  auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  from: (table: string) => {
    if (table === "projects") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: "proj-1", organization_id: "org-1" } }) }) }) };
    }
    if (table === "memberships") {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: { role: "member" } }) }) }) }) };
    }
    if (table === "organizations") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { plan: "growth" } }) }) }) };
    }
    if (table === "reports") return reportsTable;
    throw new Error(`unexpected table: ${table}`);
  },
};

const serviceClient = {
  from: (table: string) => {
    if (table === "reports") return reportsTable;
    throw new Error(`unexpected table: ${table}`);
  },
};

mock.module("@/lib/supabase/server", {
  namedExports: { createClient: async () => sessionClient, createServiceClient: async () => serviceClient },
});
mock.module("@/lib/inngest/client", { namedExports: { inngest: { send: async () => {} } } });
mock.module("@/lib/engines/report-builder", {
  namedExports: {
    gatherReportData: async () => ({ reportData: { fake: true }, whiteLabel: undefined }),
    saveReportArtifacts: async (_s: unknown, _p: string, reportId: string) => {
      const row = reportsStore.get(reportId);
      if (row) row.status = "ready";
      return "";
    },
    saveIntelligenceReportArtifacts: async () => {
      throw new Error("not exercised — this test only generates standard reports");
    },
  },
});

const { POST: generateReport } = await import("../projects/[id]/report/route.ts");

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/projects/proj-1/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("versioning: the first report in a lineage gets version 1 and no previous_report_id", async () => {
  reportsStore.clear();
  await generateReport(req({ report_type: "standard" }), { params: Promise.resolve({ id: "proj-1" }) });
  const latest = findLatest("proj-1", "standard")!;
  assert.equal(latest.version, 1);
  assert.equal(latest.previous_report_id, null);
});

test("versioning: regenerating for the same project+report_type supersedes the prior latest and bumps the version", async () => {
  reportsStore.clear();
  await generateReport(req({ report_type: "standard" }), { params: Promise.resolve({ id: "proj-1" }) });
  const v1 = findLatest("proj-1", "standard")!;

  await generateReport(req({ report_type: "standard" }), { params: Promise.resolve({ id: "proj-1" }) });
  const v2 = findLatest("proj-1", "standard")!;

  assert.equal(v2.version, 2);
  assert.equal(v2.previous_report_id, v1.id, "the new report must point back at the one it replaces");
  assert.notEqual(v2.id, v1.id, "regenerating must create a new row, not mutate the old one");

  await generateReport(req({ report_type: "standard" }), { params: Promise.resolve({ id: "proj-1" }) });
  const v3 = findLatest("proj-1", "standard")!;
  assert.equal(v3.version, 3);
  assert.equal(v3.previous_report_id, v2.id);
});

test("versioning: standard and deep report_type lineages for the same project are independent", async () => {
  reportsStore.clear();
  await generateReport(req({ report_type: "standard" }), { params: Promise.resolve({ id: "proj-1" }) });
  await generateReport(req({ report_type: "standard" }), { params: Promise.resolve({ id: "proj-1" }) });
  await generateReport(req({ report_type: "deep" }), { params: Promise.resolve({ id: "proj-1" }) });

  const standardLatest = findLatest("proj-1", "standard")!;
  const deepLatest = findLatest("proj-1", "deep")!;

  assert.equal(standardLatest.version, 2, "the standard lineage already had 2 versions");
  assert.equal(deepLatest.version, 1, "the deep lineage's first report must start at v1, unaffected by the standard lineage");
  assert.equal(deepLatest.previous_report_id, null);
});
