import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recordScanBaseline,
  recordLedgerAction,
  getLedgerForProject,
  calculatePeriodCitationDelta,
  buildGuaranteeReport,
} from "../results-ledger.ts";

/**
 * End-to-end closed loop on a seeded in-memory DB:
 *   measure (baseline) → execute (ops → ledger) → prove (report) → guarantee.
 * Asserts a REAL artifact exists at every hop and the guarantee contract reflects
 * the actual ledger — the spine of the "we back our claims / reimburse" promise.
 *
 * We use a faithful in-memory Supabase double (chainable insert/select/eq/order/
 * limit/single) so the production functions run unmodified with no live DB.
 */

type Row = Record<string, unknown>;

function memSupabase() {
  const tables = new Map<string, Row[]>();
  let idc = 0;
  const tbl = (n: string) => tables.get(n) ?? (tables.set(n, []), tables.get(n)!);

  function applyFilters(rows: Row[], filters: Array<[string, unknown]>): Row[] {
    return rows.filter((r) => filters.every(([c, v]) => (typeof v === "function" ? (v as (x: unknown) => boolean)(r[c]) : r[c] === v)));
  }

  return {
    _tables: tables,
    from(name: string) {
      const rows = tbl(name);
      const state = { op: "select" as "select" | "insert" | "update", payload: null as Row | null, filters: [] as Array<[string, unknown]> };
      const builder: Record<string, unknown> = {
        insert(payload: Row) { state.op = "insert"; state.payload = payload; return builder; },
        update(payload: Row) { state.op = "update"; state.payload = payload; return builder; },
        select() { return builder; },
        eq(col: string, val: unknown) { state.filters.push([col, val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async single() {
          if (state.op === "insert") {
            const row = { id: `id-${++idc}`, created_at: new Date().toISOString(), ...state.payload };
            rows.push(row);
            return { data: { id: row.id }, error: null };
          }
          return { data: applyFilters(rows, state.filters)[0] ?? null, error: null };
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          if (state.op === "insert") {
            const row = { id: `id-${++idc}`, created_at: new Date().toISOString(), ...state.payload };
            rows.push(row);
            resolve({ data: [{ id: row.id }], error: null });
            return;
          }
          if (state.op === "update") {
            for (const r of applyFilters(rows, state.filters)) Object.assign(r, state.payload);
            resolve({ data: [], error: null });
            return;
          }
          resolve({ data: applyFilters(rows, state.filters), error: null });
        },
      };
      return builder;
    },
  };
}

test("closed loop produces a real artifact at every hop and an honest guarantee", async () => {
  const sb = memSupabase() as never;
  const projectId = "proj-1";

  // ── Hop 1: MEASURE — capture the scan baseline.
  await recordScanBaseline(sb, projectId, { omnipresence_score: 40, citation_rate: 0.1 });
  let ledger = await getLedgerForProject(sb, projectId);
  assert.equal(ledger.length, 1, "baseline must be persisted");
  assert.equal(ledger[0].action_type, "scan_baseline");

  // ── Hop 2: EXECUTE — 6 ops complete and are recorded to the ledger.
  for (let i = 0; i < 6; i++) {
    const rec = await recordLedgerAction(sb, {
      project_id: projectId,
      action_type: "content_publish",
      action_surface: "cms",
      description: `published optimized passage ${i}`,
      baseline_snapshot: {},
      outcome_snapshot: { url: `https://site/${i}` },
      status: "completed",
    });
    assert.ok(rec?.id, "each executed op must yield a ledger id");
  }
  ledger = await getLedgerForProject(sb, projectId);
  assert.equal(ledger.length, 7, "baseline + 6 ops persisted");

  // ── Hop 3: PROVE — build the guarantee report from the REAL ledger.
  const citation = calculatePeriodCitationDelta(0.1, 0.1); // no measured KPI lift yet
  const report = buildGuaranteeReport(
    ledger,
    { before: 40, after: 41 },        // +1 score (below +15)
    { before: 100, after: 105 },      // +5 traffic (below +50)
    { before: citation.before, after: citation.after }
  );
  assert.ok(report.actionsCompleted >= 5, "report counts real completed actions");
  assert.equal(report.evidence.length, report.actionsCompleted, "evidence = the actual completed entries");

  // ── Hop 4: GUARANTEE — refund-safe model. We delivered every controllable
  // deliverable and nothing failed, so the guarantee is SATISFIED and NO refund
  // is owed — even though the uncontrollable outcome KPIs have not moved yet.
  assert.equal(report.failedDeliverables, 0, "no controllable deliverable failed");
  assert.equal(report.guaranteeEligible, true, "delivered work, nothing failed → guarantee satisfied");
  assert.equal(report.reimbursementEligible, false, "KPIs lagging is NOT a refund trigger");
});

test("when measured KPI lift IS achieved, the guarantee is satisfied (not refund-eligible)", async () => {
  const sb = memSupabase() as never;
  const projectId = "proj-2";
  for (let i = 0; i < 6; i++) {
    await recordLedgerAction(sb, {
      project_id: projectId, action_type: "cms_patch", action_surface: "cms",
      description: `fix ${i}`, baseline_snapshot: {}, outcome_snapshot: {}, status: "completed",
    });
  }
  const ledger = await getLedgerForProject(sb, projectId);
  const report = buildGuaranteeReport(
    ledger,
    { before: 40, after: 60 },   // +20 score (>= +15) → strong KPI lift
    { before: 100, after: 100 },
    { before: 0.1, after: 0.1 }
  );
  // Strong measured lift AND all deliverables met → guarantee satisfied, no refund.
  assert.equal(report.guaranteeEligible, true, "delivered work, nothing failed → guarantee satisfied");
  assert.equal(report.reimbursementEligible, false, "lift achieved and nothing failed → no refund");
  assert.ok(report.scoreChange >= 15);
});

test("a failed controllable deliverable is the ONLY refund trigger (refund-safe)", async () => {
  const sb = memSupabase() as never;
  const projectId = "proj-3";
  // Four delivered, one we promised but could not deliver/verify (status failed).
  for (let i = 0; i < 4; i++) {
    await recordLedgerAction(sb, {
      project_id: projectId, action_type: "schema_deploy", action_surface: "site",
      description: `deployed ${i}`, baseline_snapshot: {}, outcome_snapshot: {}, status: "completed",
    });
  }
  await recordLedgerAction(sb, {
    project_id: projectId, action_type: "schema_deploy", action_surface: "site",
    description: "deploy that failed", baseline_snapshot: {}, outcome_snapshot: {}, status: "failed",
  });
  const ledger = await getLedgerForProject(sb, projectId);
  const report = buildGuaranteeReport(
    ledger,
    { before: 40, after: 80 },   // even with HUGE KPI lift...
    { before: 100, after: 500 },
    { before: 0.1, after: 0.9 }
  );
  // ...a failed controllable deliverable still triggers the refund. KPI lift
  // never masks a deliverable we failed to deliver.
  assert.equal(report.failedDeliverables, 1);
  assert.equal(report.reimbursementEligible, true, "failed deliverable → refund owed");
  assert.equal(report.guaranteeEligible, false, "a failed deliverable means the guarantee is not met");
});

test("per-project isolation: one project's ledger never leaks into another's proof", async () => {
  const sb = memSupabase() as never;
  await recordLedgerAction(sb, {
    project_id: "A", action_type: "schema_deploy", action_surface: "site",
    description: "A", baseline_snapshot: {}, outcome_snapshot: {}, status: "completed",
  });
  await recordScanBaseline(sb, "B", {});
  const a = await getLedgerForProject(sb, "A");
  const b = await getLedgerForProject(sb, "B");
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].project_id, "A");
  assert.equal(b[0].action_type, "scan_baseline");
});
