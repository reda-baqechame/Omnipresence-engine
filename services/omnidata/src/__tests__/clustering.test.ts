import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agglomerate, labelCluster } from "../engines/clustering.js";

describe("agglomerative clustering", () => {
  it("groups near-identical vectors and separates distant ones", () => {
    // Two tight groups in 2D: near (1,0) and near (0,1).
    const vectors = [
      [1, 0.02],
      [0.98, 0.0],
      [0.02, 1],
      [0.0, 0.97],
    ];
    const groups = agglomerate(vectors, 0.9).map((g) => g.sort((a, b) => a - b));
    // Expect exactly two clusters of two members each.
    assert.equal(groups.length, 2);
    for (const g of groups) assert.equal(g.length, 2);
  });

  it("keeps everything separate when threshold is unreachable", () => {
    const vectors = [
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    const groups = agglomerate(vectors, 0.99);
    assert.equal(groups.length, 3);
  });
});

describe("c-TF-IDF cluster labels", () => {
  it("surfaces the distinctive term as the label", () => {
    const members = ["best running shoes", "running shoes for men", "trail running shoes"];
    const allDocs = [...members, "coffee maker reviews", "espresso machine guide"];
    const { label, terms } = labelCluster(members, allDocs);
    assert.ok(terms.includes("running") || terms.includes("shoes"));
    assert.ok(label.toLowerCase().includes("running") || label.toLowerCase().includes("shoes"));
  });
});
