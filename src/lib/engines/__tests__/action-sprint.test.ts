import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySprintOutcome,
  sprintWeekStart,
  SPRINT_MIN_SAMPLE,
  type SprintSnapshot,
} from "@/lib/engines/action-sprint";

function snap(mention: number, citation: number, sample: number): SprintSnapshot {
  return {
    mention_rate: mention,
    citation_rate: citation,
    sample_size: sample,
    captured_at: new Date().toISOString(),
  };
}

test("thin samples are inconclusive — never a directional claim", () => {
  assert.equal(classifySprintOutcome(null, snap(0.5, 0.2, 100)), "inconclusive");
  assert.equal(classifySprintOutcome(snap(0.5, 0.2, 100), null), "inconclusive");
  assert.equal(
    classifySprintOutcome(snap(0.1, 0.1, SPRINT_MIN_SAMPLE - 1), snap(0.9, 0.9, 100)),
    "inconclusive"
  );
  assert.equal(
    classifySprintOutcome(snap(0.1, 0.1, 100), snap(0.9, 0.9, SPRINT_MIN_SAMPLE - 1)),
    "inconclusive"
  );
});

test("citation movement outranks mention movement", () => {
  // Citations down 5pp while mentions up 10pp -> declined (citations decide).
  assert.equal(
    classifySprintOutcome(snap(0.30, 0.20, 100), snap(0.40, 0.15, 100)),
    "declined"
  );
  // Citations up 5pp while mentions down -> increased.
  assert.equal(
    classifySprintOutcome(snap(0.30, 0.20, 100), snap(0.20, 0.25, 100)),
    "increased"
  );
});

test("sub-threshold movement is unchanged, not noise-claimed", () => {
  assert.equal(
    classifySprintOutcome(snap(0.30, 0.20, 100), snap(0.31, 0.21, 100)),
    "unchanged"
  );
});

test("mention movement decides when citations are flat", () => {
  assert.equal(
    classifySprintOutcome(snap(0.30, 0.20, 100), snap(0.40, 0.20, 100)),
    "increased"
  );
  assert.equal(
    classifySprintOutcome(snap(0.40, 0.20, 100), snap(0.30, 0.20, 100)),
    "declined"
  );
});

test("sprintWeekStart is always a Monday and stable within a week", () => {
  // 2026-07-16 is a Thursday; its week starts Monday 2026-07-13.
  assert.equal(sprintWeekStart(new Date("2026-07-16T12:00:00Z")), "2026-07-13");
  // Sunday belongs to the week that started the previous Monday.
  assert.equal(sprintWeekStart(new Date("2026-07-19T23:00:00Z")), "2026-07-13");
  // Monday maps to itself.
  assert.equal(sprintWeekStart(new Date("2026-07-13T00:30:00Z")), "2026-07-13");
});
