import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAfterMetricFromSnapshots } from "../searchops-after-metric.ts";
import type { ExecutionTask } from "../../../types/database.ts";

function chainable(result: { data: unknown; error: null }) {
  const api: Record<string, unknown> = {};
  const self = new Proxy(api, {
    get(_t, prop: string) {
      if (prop === "maybeSingle" || prop === "single") {
        return async () => result;
      }
      if (prop === "then") return undefined;
      return () => self;
    },
  });
  return self;
}

test("GSC auto-verify returns measured metric from snapshot", async () => {
  const task: ExecutionTask = {
    id: "t1",
    project_id: "11111111-1111-1111-1111-111111111111",
    organization_id: "o1",
    title: "Strike",
    source_module: "searchops_opportunity",
    source_id: "p1:gsc:strike:best crm",
    category: "gsc",
    priority: "high",
    impact: 70,
    effort: 3,
    status: "done",
    evidence: {
      searchops_opportunity_id: "p1:gsc:strike:best crm",
      evidence: [{ value: { impressions: 100, position: 8 } }],
    },
    before_metric: { status: "measured", primary_evidence: { impressions: 100 } },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const sb = {
    from(table: string) {
      assert.equal(table, "gsc_query_snapshots");
      return chainable({
        data: {
          key: "best crm",
          dimension: "query",
          clicks: 12,
          impressions: 420,
          ctr: 0.028,
          position: 7.2,
          captured_on: "2026-07-09",
          data_source: "measured",
          range_start: "2026-06-11",
          range_end: "2026-07-08",
        },
        error: null,
      });
    },
  };

  const result = await resolveAfterMetricFromSnapshots(sb as never, { task });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.afterMetric.status, "measured");
    assert.equal(result.afterMetric.impressions, 420);
    assert.equal(result.afterMetric.source, "gsc_query_snapshots");
  }
});

test("missing snapshot is unavailable, not zero success", async () => {
  const task: ExecutionTask = {
    id: "t2",
    project_id: "11111111-1111-1111-1111-111111111111",
    organization_id: "o1",
    title: "Strike",
    source_module: "searchops_opportunity",
    source_id: "p1:gsc:strike:missing",
    category: "gsc",
    priority: "medium",
    impact: 50,
    effort: 3,
    status: "done",
    evidence: { searchops_opportunity_id: "p1:gsc:strike:missing" },
    before_metric: { status: "measured", primary_evidence: { impressions: 50 } },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const sb = {
    from() {
      return chainable({ data: null, error: null });
    },
  };

  const result = await resolveAfterMetricFromSnapshots(sb as never, { task });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /gsc_query_snapshots|Refresh GSC/i);
  }
});
