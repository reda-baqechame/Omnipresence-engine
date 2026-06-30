import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSchemaDeep } from "../schema-validation.ts";
import { passageReadinessScore } from "../passage-readiness.ts";
import type { TechnicalAuditFinding } from "../technical-audit.ts";

/**
 * Deep schema validator mirrors Google's Rich Results required/recommended
 * property rules. If this is wrong we'd tell customers their markup is valid when
 * Google would reject it (or vice-versa) — so it must match the real spec.
 */

test("a complete Product with offers is valid and rich-result eligible", () => {
  const r = validateSchemaDeep({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Widget",
    image: "https://x/i.jpg",
    description: "A widget",
    brand: "Acme",
    offers: { "@type": "Offer", price: "9.99", priceCurrency: "USD", availability: "InStock", url: "https://x" },
  });
  assert.equal(r.valid, true);
  const product = r.perType.find((p) => p.type === "Product")!;
  assert.equal(product.richResultEligible, true);
});

test("Product without offers/review/aggregateRating is NOT rich-result eligible", () => {
  const r = validateSchemaDeep({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Widget",
  });
  const product = r.perType.find((p) => p.type === "Product")!;
  assert.equal(product.richResultEligible, false);
  assert.ok(r.errors.some((e) => /offers, review, or aggregateRating/.test(e)));
});

test("missing required property produces an error and invalidates", () => {
  const r = validateSchemaDeep({ "@context": "https://schema.org", "@type": "FAQPage" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /missing required property "mainEntity"/.test(e)));
});

test("missing recommended property is a warning, not an error", () => {
  const r = validateSchemaDeep({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Title",
  });
  assert.equal(r.valid, true, "valid: only recommended props missing");
  assert.ok(r.warnings.length > 0);
});

test("missing @context on a root node is an error", () => {
  const r = validateSchemaDeep({ "@type": "Organization", name: "Acme" });
  assert.ok(r.errors.some((e) => /Missing @context/.test(e)));
});

test("@graph and nested nodes are recursively validated", () => {
  const r = validateSchemaDeep({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Acme", url: "https://acme.com", logo: "l", sameAs: ["x"], contactPoint: {} },
      { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A" } }] },
    ],
  });
  const types = r.perType.map((p) => p.type);
  assert.ok(types.includes("Organization"));
  assert.ok(types.includes("FAQPage"));
  assert.ok(types.includes("Question"), "nested Question inside mainEntity is validated");
});

test("unknown @type is recognized=false but does not error the document", () => {
  const r = validateSchemaDeep({ "@context": "https://schema.org", "@type": "SomeMadeUpType", foo: 1 });
  const node = r.perType.find((p) => p.type === "SomeMadeUpType")!;
  assert.equal(node.recognized, false);
  assert.equal(node.richResultEligible, false);
});

test("empty-string and empty-array properties do not satisfy required", () => {
  const r = validateSchemaDeep({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "  ",
    step: [],
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /missing required property "name"/.test(e)));
  assert.ok(r.errors.some((e) => /missing required property "step"/.test(e)));
});

test("no @type anywhere is an explicit error (not a silent pass)", () => {
  const r = validateSchemaDeep({ "@context": "https://schema.org", foo: "bar" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /No nodes with @type/.test(e)));
});

const mkFinding = (severity: string, category = "passage"): TechnicalAuditFinding =>
  ({ category, severity, title: "t", description: "d" } as unknown as TechnicalAuditFinding);

test("passageReadinessScore: clean findings = 100, penalties accumulate by severity", () => {
  assert.equal(passageReadinessScore([]), 100);
  assert.equal(passageReadinessScore([mkFinding("critical")]), 70);
  assert.equal(passageReadinessScore([mkFinding("high"), mkFinding("medium")]), 70);
  // floors at 0, never negative
  const many = Array.from({ length: 6 }, () => mkFinding("critical"));
  assert.equal(passageReadinessScore(many), 0);
});

test("passageReadinessScore ignores non-passage/freshness findings", () => {
  assert.equal(passageReadinessScore([mkFinding("critical", "robots")]), 100);
  assert.equal(passageReadinessScore([mkFinding("high", "freshness")]), 80);
});
