import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeCapture, sameRegistrableDomain, hostnameOf, isMentioned } from "../analyze.js";

test("hostnameOf strips www and lowercases", () => {
  assert.equal(hostnameOf("https://www.Example.com/page"), "example.com");
  assert.equal(hostnameOf("not a url"), "");
});

test("sameRegistrableDomain matches eTLD+1", () => {
  assert.equal(sameRegistrableDomain("blog.acme.com", "acme.com"), true);
  assert.equal(sameRegistrableDomain("https://www.acme.com/x", "acme.com"), true);
  assert.equal(sameRegistrableDomain("acme.com", "competitor.com"), false);
});

test("isMentioned ignores TLD and is case-insensitive", () => {
  assert.equal(isMentioned("We love Acme for this", "Acme"), true);
  assert.equal(isMentioned("acme.com is great", "acme.com"), true);
  assert.equal(isMentioned("nothing here", "Acme"), false);
});

test("analyzeCapture derives brand + competitor signals honestly", () => {
  const answer = "For project management, Acme is a strong choice. Rival Corp is also popular.";
  const cited = ["https://www.acme.com/features", "https://g2.com/acme", "https://reddit.com/r/x"];
  const result = analyzeCapture(answer, cited, "Acme", "acme.com", ["Rival Corp", "Nobody Inc"]);

  assert.equal(result.brandMentioned, true);
  assert.equal(result.brandCited, true); // acme.com is in cited sources
  assert.equal(result.competitorMentions["Rival Corp"], true);
  assert.equal(result.competitorMentions["Nobody Inc"], false);
  assert.deepEqual(result.sourceDomains.sort(), ["acme.com", "g2.com", "reddit.com"]);
});

test("analyzeCapture: brand mentioned but not cited", () => {
  const result = analyzeCapture("Acme is good.", ["https://g2.com/x"], "Acme", "acme.com", []);
  assert.equal(result.brandMentioned, true);
  assert.equal(result.brandCited, false);
});
