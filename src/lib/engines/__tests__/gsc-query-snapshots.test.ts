import { test } from "node:test";
import assert from "node:assert/strict";
import { persistGscInsightsSnapshots } from "../gsc-query-snapshots.ts";
import type { GscInsights } from "../gsc-queries.ts";

test("persistGscInsightsSnapshots upserts query/page + totals", async () => {
  const upserts: Array<{ table: string; rows: unknown }> = [];
  const sb = {
    from(table: string) {
      return {
        upsert(rows: unknown) {
          upserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const insights: GscInsights = {
    available: true,
    range: {
      current: { start: "2026-06-11", end: "2026-07-08" },
      previous: { start: "2026-05-14", end: "2026-06-10" },
    },
    totals: { clicks: 100, impressions: 5000, ctr: 0.02, avgPosition: 12 },
    topQueries: [
      { query: "alpha", clicks: 10, impressions: 200, ctr: 0.05, position: 5 },
      { query: "alpha", clicks: 10, impressions: 200, ctr: 0.05, position: 5 },
    ],
    topPages: [{ url: "https://ex.com/a", clicks: 8, impressions: 100, ctr: 0.08, position: 4 }],
    strikingDistance: [
      { query: "beta", clicks: 2, impressions: 80, ctr: 0.025, position: 9 },
    ],
    lowCtr: [],
    decay: [
      {
        url: "https://ex.com/decay",
        prevImpressions: 200,
        currImpressions: 100,
        impressionDelta: -100,
        prevClicks: 20,
        currClicks: 8,
        clickDelta: -12,
      },
    ],
    refreshCandidates: [],
  };

  const result = await persistGscInsightsSnapshots(sb as never, "proj-1", insights);
  assert.equal(result.totalsWritten, true);
  assert.ok(result.queryRows >= 2); // alpha + beta deduped
  assert.ok(result.pageRows >= 2); // top page + decay
  assert.ok(upserts.some((u) => u.table === "gsc_query_snapshots"));
  assert.ok(upserts.some((u) => u.table === "gsc_snapshots"));
});
