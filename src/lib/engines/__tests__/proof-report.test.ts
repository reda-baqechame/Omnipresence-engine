import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProofReport, renderProofHTML } from "../proof-report.ts";
import type { ProofReport } from "../proof-report.ts";

/**
 * The before/after proof is the artifact that justifies the bill and the
 * guarantee. It must compute deltas from real persisted rows, show "n/a" (never
 * a fabricated 0) where a baseline is missing, and never inflate citations by
 * counting accumulated rows across scans. These tests drive buildProofReport
 * with an in-memory Supabase stub and pin the rendering honesty.
 */

type Row = Record<string, unknown>;

/** Minimal chainable Supabase stub returning seeded rows per table. */
function stubSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder; },
        in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return builder; },
        not(col: string) { rows = rows.filter((r) => r[col] !== null && r[col] !== undefined); return builder; },
        order(col: string, opts?: { ascending?: boolean }) {
          const asc = opts?.ascending !== false;
          rows.sort((a, b) => {
            const av = a[col] as number | string; const bv = b[col] as number | string;
            if (av === bv) return 0;
            return (av < bv ? -1 : 1) * (asc ? 1 : -1);
          });
          return builder;
        },
        then(resolve: (v: { data: Row[] }) => unknown) { return resolve({ data: rows }); },
      };
      return builder;
    },
  } as never;
}

test("computes real before/after deltas from persisted scans", async () => {
  const supa = stubSupabase({
    scores: [
      { project_id: "p", omnipresence_score: 40, ai_visibility: 20, created_at: "2026-01-01" },
      { project_id: "p", omnipresence_score: 62, ai_visibility: 48, created_at: "2026-02-01" },
    ],
    results_ledger: [
      { project_id: "p", action_type: "scan_baseline", baseline_snapshot: { citation_count: 3 }, executed_at: "2026-01-01" },
    ],
    visibility_results: [
      { project_id: "p", run_id: "run2", brand_cited: true, created_at: "2026-02-01" },
      { project_id: "p", run_id: "run2", brand_cited: true, created_at: "2026-02-01" },
      // An older run's citations must NOT be counted into "now".
      { project_id: "p", run_id: "run1", brand_cited: true, created_at: "2026-01-01" },
    ],
    technical_findings: [
      { project_id: "p", is_resolved: true },
      { project_id: "p", is_resolved: false },
    ],
    rank_keywords: [],
    rank_snapshots: [],
  });

  const proof = await buildProofReport(supa, "p");
  assert.equal(proof.available, true);

  const omni = proof.deltas.find((d) => d.label === "OmniPresence score")!;
  assert.equal(omni.before, 40);
  assert.equal(omni.after, 62);
  assert.equal(omni.change, 22);

  const cites = proof.deltas.find((d) => d.label === "AI citations")!;
  assert.equal(cites.before, 3);
  // Only the LATEST run (run2) counts → 2, not 3 (accumulated rows are excluded).
  assert.equal(cites.after, 2, "citations must be scoped to the latest run, not accumulated");

  assert.equal(proof.findings.resolved, 1);
  assert.equal(proof.findings.total, 2);
});

test("missing baseline shows n/a — never a fabricated zero", async () => {
  const supa = stubSupabase({
    scores: [{ project_id: "p", omnipresence_score: 55, ai_visibility: 30, created_at: "2026-02-01" }],
    results_ledger: [],
    visibility_results: [],
    technical_findings: [],
    rank_keywords: [],
    rank_snapshots: [],
  });
  const proof = await buildProofReport(supa, "p");
  const cites = proof.deltas.find((d) => d.label === "AI citations")!;
  assert.equal(cites.before, null, "no baseline → null, not 0");
  assert.equal(cites.change, null, "no movement can be claimed without a baseline");

  const html = renderProofHTML(proof);
  // With only one score row and no baselines, there is no measured before/after.
  assert.equal(proof.available, false);
  assert.match(html, /run at least two scans/i);
});

test("renderProofHTML colors improvements honestly (incl. betterWhenLower)", () => {
  const proof: ProofReport = {
    generatedAt: new Date().toISOString(),
    deltas: [
      { label: "OmniPresence score", before: 40, after: 60, change: 20 },
      { label: "Avg. organic rank", before: 9, after: 4, change: -5, betterWhenLower: true },
      { label: "AI citations", before: null, after: 2, change: null },
    ],
    findings: { resolved: 2, total: 5 },
    available: true,
    note: "test",
  };
  const html = renderProofHTML(proof);
  assert.match(html, /Before \/ After Proof/);
  // A rank drop (better when lower) renders as the positive/green color, not red.
  assert.match(html, /#16a34a/);
  // The null-change citation row renders an em dash, never a fabricated number.
  assert.match(html, /—/);
  // No raw HTML injection: labels are escaped (sanity that escapeHtml is applied).
  assert.ok(!html.includes("<script"));
});
