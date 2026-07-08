import { test } from "node:test";
import assert from "node:assert/strict";
import { groupReportVersions } from "../version-grouping.ts";

test("groupReportVersions: a single report with no previous_report_id is its own lineage with no ancestors", () => {
  const groups = groupReportVersions([{ id: "r1", previous_report_id: null }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latest.id, "r1");
  assert.deepEqual(groups[0].ancestors, []);
});

test("groupReportVersions: a 3-version lineage collapses to one group with the latest surfaced and ancestors newest-first", () => {
  const groups = groupReportVersions([
    { id: "r1", previous_report_id: null },
    { id: "r2", previous_report_id: "r1" },
    { id: "r3", previous_report_id: "r2" },
  ]);
  assert.equal(groups.length, 1, "the two superseded versions must not appear as their own top-level entries");
  assert.equal(groups[0].latest.id, "r3");
  assert.deepEqual(
    groups[0].ancestors.map((a) => a.id),
    ["r2", "r1"],
    "ancestors must walk backward from the latest, most recent first"
  );
});

test("groupReportVersions: independent lineages (e.g. standard vs deep) never merge into each other", () => {
  const groups = groupReportVersions([
    { id: "standard-1", previous_report_id: null },
    { id: "standard-2", previous_report_id: "standard-1" },
    { id: "deep-1", previous_report_id: null },
  ]);
  assert.equal(groups.length, 2);
  const ids = groups.map((g) => g.latest.id).sort();
  assert.deepEqual(ids, ["deep-1", "standard-2"]);
});

test("groupReportVersions: a dangling previous_report_id (referenced row missing/deleted) stops the walk instead of throwing", () => {
  const groups = groupReportVersions([{ id: "r2", previous_report_id: "does-not-exist" }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latest.id, "r2");
  assert.deepEqual(groups[0].ancestors, []);
});

test("groupReportVersions: a cyclic previous_report_id chain (data anomaly) terminates instead of looping forever", () => {
  // Both rows point at each other, so each is "superseded" by the other and
  // the top-level result is legitimately empty — a two-node mutual cycle has
  // no well-defined "latest". The property under test is that this resolves
  // synchronously at all instead of hanging in an infinite while(cursor) loop.
  const groups = groupReportVersions([
    { id: "a", previous_report_id: "b" },
    { id: "b", previous_report_id: "a" },
  ]);
  assert.deepEqual(groups, []);
});

test("groupReportVersions: a self-referencing row (previous_report_id points at itself) does not infinite-loop", () => {
  // "a" supersedes itself, so it's excluded from the top-level result by the
  // same logic as the mutual-cycle case above — again, the property under
  // test is termination, not a particular grouping outcome for corrupt data.
  const groups = groupReportVersions([{ id: "a", previous_report_id: "a" }]);
  assert.deepEqual(groups, []);
});
