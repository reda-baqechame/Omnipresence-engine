import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("@/lib/providers/backlink-intelligence", {
  namedExports: {
    routeReferringDomains: async (domain: string) => ({
      available: domain === "rival.example",
      provider: "commoncrawl-webgraph",
      data:
        domain === "rival.example"
          ? [{ url: "https://source.example/l", domain: "source.example", rank: 42 }]
          : [],
    }),
    routeBacklinkGraph: async () => ({
      available: false,
      reason: "OmniData inactive",
      graph: null,
    }),
    routeLinkIntersection: async () => null,
  },
});

const { snapshotProjectBacklinks, snapshotProjectBacklinkGraph } = await import("../backlink-monitor.ts");

function stubSupabase() {
  const inserts: unknown[] = [];
  return {
    supabase: {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              order() {
                return this;
              },
              limit() {
                return this;
              },
              async maybeSingle() {
                return { data: null };
              },
            };
          },
          async insert(row: unknown) {
            inserts.push({ table, row });
            return { error: null };
          },
        };
      },
    },
    inserts,
  };
}

test("snapshotProjectBacklinks routes through sovereign-first wrapper", async () => {
  const { supabase, inserts } = stubSupabase();
  const result = await snapshotProjectBacklinks(supabase as never, "proj-1", "acme.example");
  assert.equal(result.count, 0);
  assert.equal(inserts.length, 1);
  const row = inserts[0] as { table: string; row: { total_count: number } };
  assert.equal(row.table, "backlink_snapshots");
  assert.equal(row.row.total_count, 0);
});

test("snapshotProjectBacklinkGraph returns unavailable without fake zeros when graph missing", async () => {
  const { supabase } = stubSupabase();
  const result = await snapshotProjectBacklinkGraph(supabase as never, "proj-1", "acme.example", []);
  assert.equal(result.available, false);
  assert.match(result.reason ?? "", /OmniData/i);
});
