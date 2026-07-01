import { test } from "node:test";
import assert from "node:assert/strict";
import { syncScheduleKeywords } from "../rank-schedule-service.ts";

test("syncScheduleKeywords returns 0 when no keywords", async () => {
  const sb = {
    from(name: string) {
      if (name === "rank_keywords") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [] }),
          }),
        };
      }
      return { upsert: () => Promise.resolve({ error: null }) };
    },
  };
  const n = await syncScheduleKeywords(sb as never, "sched-1", "proj-1");
  assert.equal(n, 0);
});
