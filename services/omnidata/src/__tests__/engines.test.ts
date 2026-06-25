import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { strikingDistance, detectCannibalization } from "../store.js";
import { findDomainPosition } from "../engines/serp.js";

describe("rank tracker helpers", () => {
  it("detects striking distance", () => {
    const history = [
      { position: 8 },
      { position: 12 },
      { position: 15 },
    ];
    assert.equal(strikingDistance(history), true);
  });

  it("detects cannibalization", () => {
    const urls = detectCannibalization([
      { url: "https://example.com/a", position: 5 },
      { url: "https://example.com/a", position: 12 },
      { url: "https://example.com/b", position: 20 },
    ]);
    assert.ok(urls.includes("https://example.com/a"));
  });
});

describe("serp position", () => {
  it("finds domain in organic results", () => {
    const pos = findDomainPosition(
      [
        { type: "organic", rank_absolute: 3, url: "https://example.com/page", domain: "example.com" },
      ],
      "example.com"
    );
    assert.equal(pos.position, 3);
  });
});
