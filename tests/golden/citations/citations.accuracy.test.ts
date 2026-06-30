import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  makeBrandMatcher,
  makeCompetitorMatcher,
} from "../../../src/lib/engines/brand-matcher.ts";

/**
 * Integrity audit for AI visibility & citation extraction (the brand-matcher
 * that every visibility/citation/share-of-voice number routes through). This is
 * the refund-critical guarantee: an expert dismisses the tool the instant a
 * mention or citation is wrong, so false positives MUST be zero and true
 * mentions/citations MUST be found. Runs fully offline against hand-labeled
 * transcripts (no skips).
 */

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "citations.golden.json"), "utf8")) as {
  cases: Array<{
    label: string;
    brand: { name: string; domain: string; aliases?: string[] };
    competitors: string[];
    answer: string;
    sourceDomains: string[];
    citedUrls: string[];
    expect: {
      brandMentioned: boolean;
      brandCited: boolean;
      competitorsMentioned: string[];
      competitorsCited: string[];
    };
  }>;
};

for (const c of golden.cases) {
  test(`citation integrity: ${c.label}`, () => {
    const brand = makeBrandMatcher(c.brand.name, c.brand.domain, c.brand.aliases);

    assert.equal(
      brand.mentionedIn(c.answer),
      c.expect.brandMentioned,
      `brandMentioned mismatch for "${c.label}"`
    );
    assert.equal(
      brand.citedInDomains(c.sourceDomains) || brand.citedInUrls(c.citedUrls),
      c.expect.brandCited,
      `brandCited mismatch for "${c.label}"`
    );

    const mentioned: string[] = [];
    const cited: string[] = [];
    for (const comp of c.competitors) {
      const m = makeCompetitorMatcher(comp);
      if (m.mentionedIn(c.answer)) mentioned.push(comp);
      if (m.citedInDomains(c.sourceDomains) || m.citedInUrls(c.citedUrls)) cited.push(comp);
    }
    assert.deepEqual(
      mentioned.sort(),
      [...c.expect.competitorsMentioned].sort(),
      `competitorsMentioned mismatch for "${c.label}"`
    );
    assert.deepEqual(
      cited.sort(),
      [...c.expect.competitorsCited].sort(),
      `competitorsCited mismatch for "${c.label}"`
    );
  });
}

test("citation integrity: aggregate false-positive rate is exactly zero", () => {
  // Across all labeled cases, the matcher must never claim a mention/citation
  // that the ground truth says is absent.
  let falsePositives = 0;
  for (const c of golden.cases) {
    const brand = makeBrandMatcher(c.brand.name, c.brand.domain, c.brand.aliases);
    if (brand.mentionedIn(c.answer) && !c.expect.brandMentioned) falsePositives += 1;
    if ((brand.citedInDomains(c.sourceDomains) || brand.citedInUrls(c.citedUrls)) && !c.expect.brandCited) {
      falsePositives += 1;
    }
  }
  assert.equal(falsePositives, 0, `brand-matcher produced ${falsePositives} false-positive(s)`);
});
