import { test } from "node:test";
import assert from "node:assert/strict";
import {
  opportunitiesToCsv,
  opportunitiesToExportRows,
} from "../searchops-export.ts";
import type { SearchOpsOpportunity } from "../searchops-opportunity-engine.ts";

const sample: SearchOpsOpportunity = {
  id: "p1:gsc:strike:best crm",
  projectId: "11111111-1111-1111-1111-111111111111",
  category: "gsc",
  title: "Striking distance: best crm",
  diagnosis: "Measured impressions at position 8.",
  evidence: [
    {
      label: "GSC query",
      source: "gsc_query_snapshots",
      status: "measured",
      confidence: 0.95,
      value: { impressions: 400, position: 8 },
    },
  ],
  priority: "high",
  impactType: "measured",
  effort: "medium",
  recommendedAction: "Improve ranking URL.",
  verificationPlan: "Compare GSC position after 28 days.",
  limitations: ["No invented traffic forecasts."],
};

test("export rows include evidence and verification plan", () => {
  const rows = opportunitiesToExportRows([sample]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, sample.id);
  assert.equal(rows[0].verification_plan, sample.verificationPlan);
  assert.match(rows[0].primary_evidence_json, /impressions/);
  assert.match(rows[0].evidence_statuses, /measured/);
});

test("csv includes header and escaped fields", () => {
  const csv = opportunitiesToCsv([sample]);
  assert.match(csv, /^id,category,priority/);
  assert.match(csv, /gsc:strike/);
  assert.match(csv, /verification_plan/);
});
