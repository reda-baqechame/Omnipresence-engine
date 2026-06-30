import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDataForSeoItems, findDomainPosition } from "../engines/serp.js";
import type { SerpResult } from "../types.js";

/**
 * Offline accuracy audit for the SERP PARSER (toDataForSeoItems): given a
 * provider-agnostic SerpResult, it must decompose the SERP into the correct
 * DataForSEO-shaped items — featured snippet, AI Overview + its real cited
 * sources, ranked organic (in order, with domains), People Also Ask, and the
 * local pack — with no drift. This runs with zero network so a parser regression
 * fails CI immediately, independent of any live SERP backend.
 */

const fixture: SerpResult = {
  keyword: "best project management software",
  location: "United States",
  source: "serper",
  featured_snippet: {
    type: "featured_snippet",
    title: "Top PM tools",
    url: "https://review.example/pm",
    description: "A roundup.",
  },
  ai_overview: {
    text: "Popular options include Asana and Trello.",
    sources: [
      { title: "Asana", url: "https://asana.com" },
      { title: "Trello", url: "https://trello.com" },
    ],
  },
  items: [
    { type: "organic", rank_absolute: 1, title: "Asana", url: "https://asana.com/pm", domain: "asana.com" },
    { type: "organic", rank_absolute: 2, title: "Monday", url: "https://monday.com" },
    { type: "organic", rank_absolute: 3, title: "Trello", url: "https://www.trello.com/home", domain: "trello.com" },
  ],
  people_also_ask: [
    { question: "What is the best free PM tool?", answer: "Several offer free tiers." },
    { question: "Is Asana better than Trello?" },
  ],
  local_pack: [
    { type: "local_pack_element", title: "Local Agency A", url: "https://agency-a.example" },
  ],
};

describe("SERP parser — feature decomposition (offline)", () => {
  const items = toDataForSeoItems(fixture);

  it("emits the featured snippet first (rank 0)", () => {
    assert.equal(items[0].type, "featured_snippet");
    assert.equal(items[0].rank_absolute, 0);
    assert.equal(items[0].url, "https://review.example/pm");
  });

  it("emits the AI Overview with its real cited sources", () => {
    const ai = items.find((i) => i.type === "ai_overview");
    assert.ok(ai, "AI overview present");
    assert.equal(ai!.items?.length, 2);
    const urls = ai!.items!.map((s) => s.url);
    assert.deepEqual(urls, ["https://asana.com", "https://trello.com"]);
  });

  it("ranks organic results in order and derives domains (incl. www stripping)", () => {
    const organic = items.filter((i) => i.type === "organic");
    assert.equal(organic.length, 3);
    assert.deepEqual(organic.map((o) => o.rank_absolute), [1, 2, 3]);
    // Domain derived from URL when absent, and www stripped.
    assert.equal(organic[1].domain, "monday.com");
    assert.equal(organic[2].domain, "trello.com");
  });

  it("decomposes People Also Ask and the local pack", () => {
    const paa = items.find((i) => i.type === "people_also_ask");
    assert.equal(paa?.items?.length, 2);
    assert.equal(paa?.items?.[0].title, "What is the best free PM tool?");
    const local = items.find((i) => i.type === "local_pack");
    assert.equal(local?.items?.length, 1);
  });

  it("findDomainPosition locates a brand and reports the SERP features seen before it", () => {
    const pos = findDomainPosition(items, "trello.com");
    assert.equal(pos.position, 3);
    // Features encountered before the organic match (snippet + AI overview lead the SERP).
    assert.ok(pos.features.includes("featured_snippet"));
    assert.ok(pos.features.includes("ai_overview"));
    // A domain that isn't ranking returns a null position (never a fake 0).
    assert.equal(findDomainPosition(items, "notpresent.example").position, null);
  });
});
