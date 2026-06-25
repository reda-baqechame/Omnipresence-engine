/**
 * One-time admin job: ingest a Common Crawl domain webgraph release into the
 * local DuckDB index so backlink queries return REAL referring domains.
 *
 * Usage:
 *   npm run webgraph:ingest -- cc-main-2024-aug-sep-oct
 *
 * Find the latest release id at:
 *   https://commoncrawl.org/web-graphs
 *   https://data.commoncrawl.org/projects/hyperlinkgraph/
 *
 * Requires the optional native dependency `@duckdb/node-api` and several GB of
 * free disk + bandwidth. Safe to re-run; tables are replaced.
 */
import { ingestWebgraph } from "../engines/webgraph.js";

async function main() {
  const release = process.argv[2];
  if (!release) {
    console.error("Usage: npm run webgraph:ingest -- <crawl-release-id>");
    process.exitCode = 1;
    return;
  }
  console.log(`Ingesting Common Crawl webgraph release "${release}" -> DuckDB...`);
  console.log("This streams multi-GB files and can take a while.");
  const result = await ingestWebgraph(release);
  if (result.ok) {
    console.log(`✓ ${result.message}`);
  } else {
    console.error(`✗ ${result.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
