import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CLAIMS,
  CAPABILITY_CHECKS,
  FORBIDDEN_PHRASES,
  findForbiddenClaims,
  isCopyAllowed,
  getClaimsCoverage,
  type Claim,
} from "../claims.ts";

/**
 * Claims-vs-reality audit: every advertised claim must (1) map to capability
 * keys that actually exist, (2) be backed by a REAL engine/provider module in
 * the repo, (3) declare an honest provenance (measured / first-party — never
 * "estimated" or "simulated" for a headline claim), and (4) contain no forbidden
 * outcome promise. If a claim can't be backed, the capability gate hides it
 * rather than letting it become a lie. This is the refund-safety contract.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const exists = (rel: string) => existsSync(join(repoRoot, rel));

/** Each claim → the real module(s) that produce its output. At least one must exist. */
const BACKING_MODULES: Record<string, string[]> = {
  ai_visibility_tracking: ["src/lib/engines/visibility-scanner.ts", "src/lib/engines/brand-matcher.ts"],
  source_citation_graph: ["src/lib/engines/source-graph.ts"],
  real_ai_answer_capture: ["src/lib/providers/ai-ui-capture.ts", "src/lib/providers/perplexity.ts"],
  serp_rank_tracking: ["src/lib/providers/serp-router.ts", "src/lib/providers/searxng.ts"],
  product_ai_visibility: ["src/lib/engines/product-visibility.ts"],
  domain_authority: ["src/lib/providers/domain-authority.ts"],
  backlink_intelligence: ["src/lib/providers/backlinks-free.ts"],
  technical_audit: ["src/lib/engines/technical-audit.ts"],
  schema_deployment: ["src/lib/engines/schema-engine.ts", "src/lib/engines/schema-validation.ts"],
  content_optimization: ["src/lib/engines/content-optimizer.ts", "src/lib/engines/structural-aeo.ts"],
  attribution_proof: ["src/lib/engines/attribution.ts"],
  guarantee_deterministic: ["src/lib/engines/guarantee.ts"],
};

const HONEST_PROVENANCE = new Set(["measured", "first_party_when_connected"]);

test("there are exactly 12 claims and all ids are unique", () => {
  assert.equal(CLAIMS.length, 12);
  const ids = CLAIMS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "claim ids must be unique");
});

test("every claim's capability keys exist in the capability gate (no dangling claim)", () => {
  for (const claim of CLAIMS) {
    const keys = [...(claim.requires ?? []), ...(claim.requiresAny ?? [])];
    assert.ok(keys.length > 0, `claim "${claim.id}" must declare a capability requirement`);
    for (const k of keys) {
      assert.ok(CAPABILITY_CHECKS[k], `claim "${claim.id}" references unknown capability "${k}"`);
    }
  }
});

test("every claim is backed by a REAL module that produces its output", () => {
  for (const claim of CLAIMS) {
    const mods = BACKING_MODULES[claim.id];
    assert.ok(mods, `claim "${claim.id}" has no backing-module mapping in the audit`);
    assert.ok(
      mods.some(exists),
      `claim "${claim.id}" is unbacked — none of its modules exist: ${mods.join(", ")}`
    );
  }
});

test("every headline claim declares an honest provenance (never estimated/simulated)", () => {
  for (const claim of CLAIMS) {
    assert.ok(
      HONEST_PROVENANCE.has(claim.provenance),
      `claim "${claim.id}" provenance "${claim.provenance}" is not measured/first-party`
    );
  }
});

test("no claim's own text contains a forbidden outcome promise", () => {
  for (const claim of CLAIMS) {
    assert.equal(isCopyAllowed(claim.text), true, `claim "${claim.id}" text contains a forbidden phrase`);
  }
});

test("the forbidden-claim guard catches every forbidden phrase, passes honest copy", () => {
  for (const phrase of FORBIDDEN_PHRASES) {
    const hits = findForbiddenClaims(`Our product will ${phrase} for you`);
    assert.ok(hits.includes(phrase), `guard must catch "${phrase}"`);
  }
  assert.equal(isCopyAllowed("Track and improve your AI visibility with measured, transparent reporting."), true);
});

test("coverage report shape: every claim has a backed boolean (gate can hide unbacked)", () => {
  const coverage = getClaimsCoverage();
  assert.equal(coverage.length, CLAIMS.length);
  for (const c of coverage) {
    assert.equal(typeof c.backed, "boolean");
    assert.ok((c.claim as Claim).id);
  }
});
