import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeDom, hashDom } from "../dom-hash.js";

test("canonicalizeDom strips dynamic ids and timestamps", () => {
  const a = `<div id="abc-123-ts-1710000000000"><p>Answer text</p></div>`;
  const b = `<div id="xyz-999-ts-1720000000000"><p>Answer text</p></div>`;
  assert.equal(canonicalizeDom(a), canonicalizeDom(b));
});

test("canonicalizeDom removes scripts and nonce attributes", () => {
  const withScript = `<html><script>window.__nonce="abc"</script><div nonce="x">ok</div></html>`;
  const withoutScript = `<html><div>ok</div></html>`;
  assert.equal(canonicalizeDom(withScript), canonicalizeDom(withoutScript));
});

test("hashDom is stable for equivalent canonical DOM", () => {
  const htmlA = `<main id="dyn-1" data-ts="2026-07-01T12:00:00Z"><p>Same content</p></main>`;
  const htmlB = `<main id="dyn-2" data-ts="2026-07-01T13:00:00Z"><p>Same content</p></main>`;
  assert.equal(hashDom(htmlA), hashDom(htmlB));
});

test("hashDom differs when structural content changes", () => {
  const a = `<main><p>Version A</p></main>`;
  const b = `<main><p>Version B</p></main>`;
  assert.notEqual(hashDom(a), hashDom(b));
});
