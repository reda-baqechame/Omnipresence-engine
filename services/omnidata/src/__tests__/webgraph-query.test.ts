import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/**
 * Real integration test for the Common Crawl webgraph query layer.
 *
 * It seeds a tiny synthetic graph (in the exact reversed-host / table shape the
 * real ingest produces) through the SAME DuckDB connection the engine uses, then
 * exercises the public query helpers. This proves the backlink/authority moat
 * returns correct referring domains + authority — not a mock. Skips cleanly when
 * the optional @duckdb/node-api binding isn't installed (e.g. unsupported CI).
 */
test("webgraph query layer returns real referring domains + authority", async (t) => {
  const dbPath = path.join(os.tmpdir(), `wg-test-${process.pid}-${Date.now()}.duckdb`);
  process.env.WEBGRAPH_DB_PATH = dbPath;

  const wg = await import("../engines/webgraph.js");
  const conn = await wg.getConnection();
  if (!conn) {
    t.skip("@duckdb/node-api not installed — skipping live webgraph query test");
    return;
  }

  try {
    // Seed vertices/edges/ranks mimicking real CC domain-graph output.
    // Reversed-host form: example.com -> com.example, wikipedia.org -> org.wikipedia.
    await conn.run("CREATE OR REPLACE TABLE vertices(id BIGINT, rev_host VARCHAR);");
    await conn.run(
      `INSERT INTO vertices VALUES
        (1,'com.example'),(2,'com.linker-a'),(3,'com.linker-b'),(4,'org.wikipedia');`
    );
    await conn.run("CREATE OR REPLACE TABLE edges(from_id BIGINT, to_id BIGINT);");
    // linker-a, linker-b and wikipedia all link TO example.com (to_id=1).
    // example.com links to linker-a (outbound, excluded) and to itself (1,1)
    // (self-loop, must be excluded from both the list and the count).
    await conn.run("INSERT INTO edges VALUES (2,1),(3,1),(4,1),(1,2),(1,1);");
    await conn.run(
      "CREATE OR REPLACE TABLE ranks(harmonic_pos BIGINT, harmonic_val DOUBLE, pr_pos BIGINT, pr_val DOUBLE, rev_host VARCHAR);"
    );
    await conn.run(
      `INSERT INTO ranks VALUES
        (15, 2.2e7, 31, 0.001, 'org.wikipedia'),
        (5,  2.7e7, 7,  0.005, 'com.example');`
    );

    // 1) Real referring domains (inbound links), self excluded.
    const inbound = await wg.getInboundLinks("example.com", 100);
    assert.ok(inbound, "getInboundLinks returned null on a ready index");
    const sources = inbound!.map((l) => l.source_domain).sort();
    assert.deepEqual(sources, ["linker-a.com", "linker-b.com", "wikipedia.org"]);
    assert.ok(!sources.includes("example.com"), "must exclude the target's own domain");

    // 2) Distinct referring-domain count — must exclude the self-loop (1,1),
    // so 3, not 4.
    const count = await wg.getReferringDomainCount("example.com");
    assert.equal(count, 3, "referring-domain count must exclude self-links");

    // 3) Real authority from harmonic centrality (lower pos = more authoritative).
    const wiki = await wg.getDomainAuthority("wikipedia.org");
    assert.ok(wiki, "wikipedia authority missing");
    assert.equal(wiki!.harmonic_pos, 15);
    assert.ok(wiki!.authority > 0 && wiki!.authority <= 100, "authority in 0..100");
    const example = await wg.getDomainAuthority("example.com");
    assert.ok(example, "example authority missing");
    // pos 5 is more authoritative than pos 15 -> higher score.
    assert.ok(example!.authority >= wiki!.authority, "lower rank position = higher authority");

    // 4) Batch authority resolves both hosts in one query (the DR-for-backlinks path).
    const batch = await wg.getDomainAuthorityBatch(["wikipedia.org", "example.com", "unranked.com"]);
    assert.equal(batch.get("wikipedia.org"), wiki!.authority);
    assert.equal(batch.get("example.com"), example!.authority);
    assert.ok(!batch.has("unranked.com"), "absent hosts must not appear in the map");
  } finally {
    try {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}.wal`, { force: true });
    } catch {
      /* temp cleanup best-effort */
    }
  }
});
