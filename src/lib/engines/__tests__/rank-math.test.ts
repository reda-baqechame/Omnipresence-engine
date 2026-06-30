import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ctrByPosition,
  shareOfVoiceFromPositions,
  isStrikingDistance,
  classifyRankChange,
} from "../rank-math.ts";

/**
 * Rank math drives client-facing rankings: share-of-voice, striking-distance
 * targeting, and rank-drop alerts. Wrong thresholds = wrong alerts / wrong SoV =
 * a refund. These tests pin the exact behavior the rank tracker depends on.
 */

test("ctrByPosition is non-increasing with worse position and zero off the curve", () => {
  const positions = [1, 2, 3, 5, 10, 20];
  const ctrs = positions.map(ctrByPosition);
  for (let i = 1; i < ctrs.length; i++) {
    assert.ok(ctrs[i] <= ctrs[i - 1], `CTR must not increase with worse position (${positions[i]})`);
  }
  // Off-curve / invalid positions contribute no clicks (never NaN/negative).
  for (const p of [null, 0, -3, 21, 100]) {
    const c = ctrByPosition(p);
    assert.ok(Number.isFinite(c) && c >= 0, `ctr(${p}) must be finite >=0`);
  }
  assert.equal(ctrByPosition(21), 0);
  assert.equal(ctrByPosition(null), 0);
});

test("shareOfVoice: a lone #1 with no competitors is 100%", () => {
  assert.equal(shareOfVoiceFromPositions(1, []), 1);
});

test("shareOfVoice: never NaN when nobody ranks", () => {
  assert.equal(shareOfVoiceFromPositions(null, [null, null]), 0);
  assert.equal(shareOfVoiceFromPositions(21, [50]), 0);
});

test("shareOfVoice: outranking a competitor yields the larger share", () => {
  const sov = shareOfVoiceFromPositions(1, [5]); // 0.28 / (0.28 + 0.06)
  assert.ok(sov > 0.5 && sov <= 1, `expected dominant share, got ${sov}`);
  // Symmetry: being the weaker one gives the smaller share, and they sum to 1.
  const inverse = shareOfVoiceFromPositions(5, [1]);
  assert.ok(Math.abs(sov + inverse - 1) < 0.002, "our + their share should sum to ~1");
});

test("isStrikingDistance only flags page 2-3 (positions 4-20)", () => {
  assert.equal(isStrikingDistance(1), false, "already winning");
  assert.equal(isStrikingDistance(3), false, "top 3 is not striking distance");
  assert.equal(isStrikingDistance(4), true);
  assert.equal(isStrikingDistance(20), true);
  assert.equal(isStrikingDistance(21), false, "too far to be striking distance");
  assert.equal(isStrikingDistance(null), false);
});

test("classifyRankChange: no previous position → no alert (can't claim a drop)", () => {
  const c = classifyRankChange(null, 15);
  assert.equal(c.isAlert, false);
  assert.equal(c.delta, null);
});

test("classifyRankChange: dropping off page 1 alerts", () => {
  const c = classifyRankChange(8, 14);
  assert.equal(c.droppedOffPage1, true);
  assert.equal(c.isAlert, true);
  assert.equal(c.delta, 6);
});

test("classifyRankChange: a 5+ position drop alerts even within page 1", () => {
  const c = classifyRankChange(2, 9); // still page 1 but dropped 7
  assert.equal(c.droppedOffPage1, false);
  assert.equal(c.bigDrop, true);
  assert.equal(c.isAlert, true);
});

test("classifyRankChange: losing the ranking entirely alerts", () => {
  const c = classifyRankChange(4, null);
  assert.equal(c.lostRanking, true);
  assert.equal(c.droppedOffPage1, true);
  assert.equal(c.isAlert, true);
  assert.equal(c.delta, null, "delta is null when there is no current position");
});

test("classifyRankChange: an improvement never fires a drop alert", () => {
  const c = classifyRankChange(10, 3);
  assert.equal(c.isAlert, false);
  assert.equal(c.delta, -7, "negative delta = improvement");
});
