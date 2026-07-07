import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("trust-ui backlinks unavailable", () => {
  it("backlinks panel shows webgraph not ingested message", () => {
    const src = readFileSync(join(root, "src/components/backlinks-panel.tsx"), "utf8");
    assert.match(src, /Backlink index not ingested/);
    assert.match(src, /webgraphReady/);
  });

  it("agencies page uses beta disclaimer not dollar pricing", () => {
    const src = readFileSync(join(root, "src/app/agencies/page.tsx"), "utf8");
    assert.match(src, /Professional beta/);
    assert.doesNotMatch(src, /\$0/);
  });
});
