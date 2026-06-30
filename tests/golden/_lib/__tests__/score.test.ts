import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDomain,
  setScore,
  meanAbsoluteError,
  meanAbsolutePercentageError,
  withinTolerance,
  spearmanRankCorrelation,
  monotonicViolations,
  inTopK,
} from "../score.ts";

/**
 * The scoring helpers ARE the measuring instrument for every accuracy audit, so
 * they must be provably correct themselves — a wrong recall formula would let a
 * broken engine pass. These pin each helper against hand-computed values.
 */

test("normalizeDomain strips scheme, www, path, query and trailing dot", () => {
  assert.equal(normalizeDomain("https://www.Example.com/path?x=1#y"), "example.com");
  assert.equal(normalizeDomain("HTTP://Foo.BAR.com."), "foo.bar.com");
});

test("setScore computes precision/recall/f1 for partial overlap", () => {
  // predicted finds 2 of 3 truth, plus 1 wrong → TP=2, FP=1, FN=1
  const s = setScore(
    ["a.com", "b.com", "wrong.com"],
    ["a.com", "b.com", "c.com"]
  );
  assert.equal(s.truePositives, 2);
  assert.equal(s.falsePositives, 1);
  assert.equal(s.falseNegatives, 1);
  assert.ok(Math.abs(s.precision - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s.recall - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s.f1 - 2 / 3) < 1e-9);
});

test("setScore: perfect recall when all truth found", () => {
  const s = setScore(["a.com", "b.com"], ["a.com", "b.com"]);
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
});

test("meanAbsoluteError and MAPE compute correctly", () => {
  assert.equal(meanAbsoluteError([{ predicted: 10, expected: 12 }, { predicted: 5, expected: 5 }]), 1);
  assert.ok(Math.abs(meanAbsolutePercentageError([{ predicted: 90, expected: 100 }]) - 0.1) < 1e-9);
});

test("withinTolerance respects the percentage band", () => {
  assert.equal(withinTolerance(95, 100, 0.1), true);
  assert.equal(withinTolerance(80, 100, 0.1), false);
});

test("spearmanRankCorrelation is 1 for identical ordering, -1 for reversed", () => {
  assert.ok(Math.abs(spearmanRankCorrelation([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9);
  assert.ok(Math.abs(spearmanRankCorrelation([1, 2, 3, 4], [40, 30, 20, 10]) + 1) < 1e-9);
});

test("monotonicViolations counts out-of-order pairs", () => {
  assert.equal(monotonicViolations([100, 90, 80, 70], "desc"), 0);
  assert.equal(monotonicViolations([100, 95, 96, 70], "desc"), 1);
});

test("inTopK checks normalized membership within K", () => {
  assert.equal(inTopK(["https://www.A.com", "b.com", "c.com"], "a.com", 1), true);
  assert.equal(inTopK(["a.com", "b.com", "c.com"], "c.com", 2), false);
});
