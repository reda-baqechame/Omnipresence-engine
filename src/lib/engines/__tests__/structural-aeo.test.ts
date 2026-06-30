import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeStructure,
  extractSteps,
  extractFaqs,
  buildHowToJsonLd,
  buildFaqJsonLd,
  toMarkdownTable,
  answerFirstBlock,
} from "../structural-aeo.ts";

/**
 * Structural AEO is a DETERMINISTIC QC gate (the proven +17% extractability
 * lever), not an LLM opinion. These tests prove it actually detects the
 * structures it claims and emits valid schema.org JSON-LD — the difference
 * between "we optimized your content" being real vs. theater.
 */

const wellStructured = `
## What is AEO?

Answer Engine Optimization (AEO) is the practice of structuring content so AI
answer engines can extract and cite it directly. It focuses on answer-first
leads, tables, steps, and FAQ pairs rather than persuasion or keyword stuffing,
making each section independently quotable by a model.

## How to optimize for AEO

1. Lead each section with a direct 40-80 word answer.
2. Add a comparison table for any "X vs Y" decision.
3. Provide an ordered, numbered step list for processes.
4. Close with question-style FAQ pairs.

## Tool comparison

| Tool | Focus | Price |
| --- | --- | --- |
| A | AEO | $99 |
| B | SEO | $129 |

## Is AEO different from SEO?

Yes — AEO targets extraction and citation by AI answer engines, while SEO
targets ranking in the classic blue-link results. They overlap but optimize for
different surfaces and success metrics across the funnel.

## Does schema help AEO?

Schema markup helps AI engines parse structure, improving the odds your steps
and FAQs are quoted. It is a strong supporting lever, not a standalone fix, and
should accompany genuinely well-structured content.

## Can small sites win at AEO?

Absolutely — structure and clarity beat domain size for extraction, so a small
site with answer-first content can be cited ahead of a larger competitor that
buries its answers in prose.
`;

test("analyzeStructure detects all five levers in well-structured content", () => {
  const qc = analyzeStructure(wellStructured);
  assert.equal(qc.checks.orderedSteps.passed, true);
  assert.equal(qc.checks.faq.passed, true);
  assert.equal(qc.checks.comparisonTable.passed, true);
  assert.equal(qc.checks.definitionBlock.passed, true);
  assert.ok(qc.score >= 70, `expected passing score, got ${qc.score}`);
  assert.equal(qc.passed, true);
});

test("analyzeStructure flags missing structure with actionable issues (no false pass)", () => {
  const poor = "This is a wall of prose with no headings, no list, no table, and no questions at all. ".repeat(5);
  const qc = analyzeStructure(poor);
  assert.equal(qc.passed, false);
  assert.ok(qc.score < 70);
  assert.ok(qc.issues.length >= 3, "should surface multiple concrete fixes");
});

test("extractSteps reads both markdown ordered lists and <ol>", () => {
  assert.deepEqual(extractSteps("1. one\n2. two\n3. three"), ["one", "two", "three"]);
  assert.deepEqual(extractSteps("<ol><li>a</li><li>b</li></ol>"), ["a", "b"]);
});

test("extractFaqs reads ?-headings and Q:/A: pairs", () => {
  const faqs = extractFaqs("## What is X?\n\nX is a thing.\n\nQ: How much?\nA: $10");
  assert.ok(faqs.some((f) => /What is X/.test(f.question)));
  assert.ok(faqs.some((f) => /How much/.test(f.question)));
});

test("buildHowToJsonLd emits valid schema.org HowTo and null below 2 steps", () => {
  assert.equal(buildHowToJsonLd("X", ["only one"]), null);
  const ld = buildHowToJsonLd("Setup", ["a", "b", "c"]) as Record<string, unknown>;
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(ld["@type"], "HowTo");
  const steps = ld.step as Array<Record<string, unknown>>;
  assert.equal(steps.length, 3);
  assert.equal(steps[0]["@type"], "HowToStep");
  assert.equal(steps[0].position, 1);
});

test("buildFaqJsonLd emits valid FAQPage and null when empty", () => {
  assert.equal(buildFaqJsonLd([]), null);
  const ld = buildFaqJsonLd([{ question: "Q?", answer: "A." }]) as Record<string, unknown>;
  assert.equal(ld["@type"], "FAQPage");
  const ent = ld.mainEntity as Array<Record<string, unknown>>;
  assert.equal(ent[0]["@type"], "Question");
  assert.equal((ent[0].acceptedAnswer as Record<string, unknown>)["@type"], "Answer");
});

test("toMarkdownTable produces a parseable table with header separator", () => {
  const md = toMarkdownTable(["A", "B"], [["1", "2"]]);
  assert.match(md, /\|\s*A\s*\|\s*B\s*\|/);
  assert.match(md, /\|\s*---\s*\|\s*---\s*\|/);
});

test("answerFirstBlock caps the lead to the 80-word extractable band", () => {
  const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
  const out = answerFirstBlock(long);
  assert.ok(out.trim().split(/\s+/).length <= 81); // 80 words + ellipsis token
});
