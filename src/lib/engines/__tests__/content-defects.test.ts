import { test } from "node:test";
import assert from "node:assert/strict";
import { detectContentDefects } from "../content-defects.ts";

/**
 * Unit tests for the professional-output defect gate. Runs on Node's native TS
 * support (no extra deps). Excluded from tsc/Next via tsconfig `exclude`.
 */

test("clean professional copy has no defects", () => {
  const clean = `## Why AI visibility matters

Brands that publish clear, well-structured answers earn more citations from AI
search engines. Here is how to start:

- Audit your current AI mentions across ChatGPT, Claude, and Gemini.
- Fix the technical gaps that block crawlers.
- Publish authoritative, schema-rich content.

What does this mean for your pipeline? More qualified, intent-driven traffic.`;
  assert.deepEqual(detectContentDefects(clean), []);
});

test("content written ABOUT ai is not falsely flagged", () => {
  // Legitimate marketing copy for an AI company must pass.
  const aboutAi = `Our artificial intelligence platform helps teams ship faster.
As a leader in machine learning, we build models that scale.`;
  assert.deepEqual(detectContentDefects(aboutAi), []);
});

test("flags AI self-reference disclaimers", () => {
  assert.ok(detectContentDefects("As an AI language model, I cannot do that.").includes("AI self-reference"));
  assert.ok(detectContentDefects("As a language model, I lack opinions.").length > 0);
  assert.ok(detectContentDefects("As an AI, I will help you write this.").length > 0);
  assert.ok(detectContentDefects("I'm an AI built to assist.").length > 0);
});

test("flags refusals, apologies and meta-references", () => {
  assert.ok(detectContentDefects("I'm sorry, but I can't help with that request.").length > 0);
  assert.ok(detectContentDefects("Unfortunately, I cannot browse the web.").length > 0);
  assert.ok(detectContentDefects("Based on my training data, the answer is unclear.").length > 0);
  assert.ok(detectContentDefects("I cannot provide real-time access to that.").length > 0);
});

test("flags unfinished placeholders and template tokens", () => {
  assert.ok(detectContentDefects("Welcome to [Company Name], the best choice.").length > 0);
  assert.ok(detectContentDefects("Contact us at {{email}} today.").length > 0);
  assert.ok(detectContentDefects("Lorem ipsum dolor sit amet.").length > 0);
  assert.ok(detectContentDefects("TODO: write the conclusion.").length > 0);
  assert.ok(detectContentDefects("Call XXXX to learn more.").length > 0);
});

test("de-duplicates repeated defect classes", () => {
  const out = detectContentDefects("As a language model, as a language model, I repeat.");
  assert.equal(out.filter((d) => d === "AI self-reference").length, 1);
});

test("empty input is clean", () => {
  assert.deepEqual(detectContentDefects(""), []);
});
