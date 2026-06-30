import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMeasured,
  isCountableVisibility,
  isSimulated,
  resultDataQuality,
  provenanceLabel,
} from "../provenance.ts";

/**
 * The provenance helpers are the single most important refund-safety primitive:
 * they decide what counts as real and prevent a failed provider from being shown
 * as a confident zero. These pin the trust rules.
 */

test("isCountableVisibility counts only measured + model_knowledge", () => {
  assert.equal(isCountableVisibility("measured"), true);
  assert.equal(isCountableVisibility("model_knowledge"), true);
  assert.equal(isCountableVisibility("estimated"), false);
  assert.equal(isCountableVisibility("simulated"), false);
  assert.equal(isCountableVisibility("unavailable"), false);
  assert.equal(isCountableVisibility(null), false);
});

test("isMeasured is strict (only live measurement)", () => {
  assert.equal(isMeasured("measured"), true);
  assert.equal(isMeasured("model_knowledge"), false);
});

test("isSimulated flags only demo rows", () => {
  assert.equal(isSimulated("simulated"), true);
  assert.equal(isSimulated("measured"), false);
});

test("resultDataQuality prefers the first-class column, then legacy raw_response", () => {
  assert.equal(resultDataQuality({ data_source: "measured" }), "measured");
  assert.equal(resultDataQuality({ raw_response: { data_source: "estimated" } }), "estimated");
  assert.equal(resultDataQuality({ raw_response: { demo: true } }), "simulated");
});

test("resultDataQuality defaults to unavailable — never a silent real zero", () => {
  assert.equal(resultDataQuality({}), "unavailable");
  assert.equal(resultDataQuality({ raw_response: {} }), "unavailable");
});

test("provenanceLabel never throws and labels unknown as Unavailable", () => {
  assert.equal(provenanceLabel("measured"), "Live");
  assert.equal(provenanceLabel(null), "Unavailable");
  assert.equal(provenanceLabel(undefined), "Unavailable");
});
