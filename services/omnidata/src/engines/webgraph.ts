/**
 * Common Crawl Host/Domain Web Graph -> DuckDB inbound-link index.
 *
 * This gives REAL referring domains (not the deprecated `link:` operator and
 * not the domain's own pages). The graph is large, so ingestion is a one-time
 * admin job per crawl release (`npm run webgraph:ingest -- <release>`), after
 * which inbound-link queries are fast.
 *
 * Everything degrades gracefully: if DuckDB or the index is unavailable, the
 * query helpers return null and the caller falls back to OpenPageRank + `link:`.
 *
 * Common Crawl domain webgraph layout (public, no auth):
 *   https://data.commoncrawl.org/projects/hyperlinkgraph/<release>/domain/
 *     <release>-domain-vertices.txt.gz   (id \t reversed_host)
 *     <release>-domain-edges.txt.gz      (from_id \t to_id)
 *     <release>-domain-ranks.txt.gz      (harmonicc_pos harmonicc_val pr_pos pr_val host)
 */

const DB_PATH = process.env.WEBGRAPH_DB_PATH || "./data/webgraph.duckdb";
const CC_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";

interface DuckDBReader {
  getRowObjects(): Array<Record<string, unknown>>;
}
interface DuckDBConnection {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<DuckDBReader>;
}
interface DuckDBInstanceLike {
  connect(): Promise<DuckDBConnection>;
}
interface DuckDBModule {
  DuckDBInstance: { create(path: string): Promise<DuckDBInstanceLike> };
}

let cachedConn: DuckDBConnection | null = null;
let duckUnavailable = false;

async function loadDuckDB(): Promise<DuckDBModule | null> {
  if (duckUnavailable) return null;
  try {
    // Optional native dependency; absence must never break the service.
    // Variable specifier keeps tsc from requiring the module to be installed.
    const spec = "@duckdb/node-api";
    return (await import(spec)) as unknown as DuckDBModule;
  } catch {
    duckUnavailable = true;
    return null;
  }
}

async function getConnection(): Promise<DuckDBConnection | null> {
  if (cachedConn) return cachedConn;
  const mod = await loadDuckDB();
  if (!mod) return null;
  try {
    const instance = await mod.DuckDBInstance.create(DB_PATH);
    cachedConn = await instance.connect();
    return cachedConn;
  } catch {
    duckUnavailable = true;
    return null;
  }
}

/** example.com -> com.example (Common Crawl reversed-host form). */
export function reverseHost(host: string): string {
  return host
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase()
    .split(".")
    .reverse()
    .join(".");
}

function unreverseHost(rev: string): string {
  return rev.split(".").reverse().join(".");
}

function sanitizeRelease(release: string): string {
  if (!/^[a-z0-9-]+$/i.test(release)) {
    throw new Error(`Invalid crawl release id: ${release}`);
  }
  return release;
}

function sanitizeRevHost(rev: string): string {
  if (!/^[a-z0-9.-]+$/i.test(rev)) {
    throw new Error("Invalid host");
  }
  return rev;
}

export interface InboundLink {
  source_domain: string;
  link_count: number;
}

/** Build the DuckDB index from a Common Crawl domain webgraph release (heavy, one-time). */
export async function ingestWebgraph(release: string): Promise<{ ok: boolean; message: string }> {
  const conn = await getConnection();
  if (!conn) return { ok: false, message: "DuckDB unavailable (install @duckdb/node-api)" };

  const rel = sanitizeRelease(release);
  const base = `${CC_BASE}/${rel}/domain/${rel}-domain`;

  try {
    await conn.run("INSTALL httpfs; LOAD httpfs;");
    await conn.run(
      `CREATE OR REPLACE TABLE vertices AS
         SELECT CAST(column0 AS BIGINT) AS id, column1 AS rev_host
         FROM read_csv('${base}-vertices.txt.gz', delim='\t', header=false,
                       columns={'column0':'VARCHAR','column1':'VARCHAR'});`
    );
    await conn.run(
      `CREATE OR REPLACE TABLE edges AS
         SELECT CAST(column0 AS BIGINT) AS from_id, CAST(column1 AS BIGINT) AS to_id
         FROM read_csv('${base}-edges.txt.gz', delim='\t', header=false,
                       columns={'column0':'VARCHAR','column1':'VARCHAR'});`
    );
    await conn.run("CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);");
    await conn.run(
      `CREATE OR REPLACE TABLE meta AS SELECT '${rel}' AS release, now() AS ingested_at,
         (SELECT COUNT(*) FROM vertices) AS vertex_count,
         (SELECT COUNT(*) FROM edges) AS edge_count;`
    );
    return { ok: true, message: `Ingested ${rel}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "ingest failed" };
  }
}

export async function isWebgraphReady(): Promise<boolean> {
  const conn = await getConnection();
  if (!conn) return false;
  try {
    const reader = await conn.runAndReadAll(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_name IN ('vertices','edges')"
    );
    const rows = reader.getRowObjects();
    return Number(rows[0]?.c ?? 0) >= 2;
  } catch {
    return false;
  }
}

/** Real inbound links (referring domains) for a host from the webgraph index. */
export async function getInboundLinks(host: string, limit = 100): Promise<InboundLink[] | null> {
  const conn = await getConnection();
  if (!conn) return null;
  if (!(await isWebgraphReady())) return null;

  try {
    const rev = sanitizeRevHost(reverseHost(host));
    const lim = Math.max(1, Math.min(limit, 1000));
    const reader = await conn.runAndReadAll(
      `SELECT v2.rev_host AS source_rev, COUNT(*) AS link_count
         FROM edges e
         JOIN vertices v1 ON v1.id = e.to_id
         JOIN vertices v2 ON v2.id = e.from_id
        WHERE v1.rev_host = '${rev}' AND v2.rev_host <> '${rev}'
        GROUP BY v2.rev_host
        ORDER BY link_count DESC
        LIMIT ${lim};`
    );
    return reader.getRowObjects().map((r) => ({
      source_domain: unreverseHost(String(r.source_rev)),
      link_count: Number(r.link_count ?? 1),
    }));
  } catch {
    return null;
  }
}

/** Total referring-domain count for a host (cheaper than fetching the list). */
export async function getReferringDomainCount(host: string): Promise<number | null> {
  const conn = await getConnection();
  if (!conn) return null;
  if (!(await isWebgraphReady())) return null;
  try {
    const rev = sanitizeRevHost(reverseHost(host));
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(DISTINCT e.from_id) AS c
         FROM edges e JOIN vertices v1 ON v1.id = e.to_id
        WHERE v1.rev_host = '${rev}';`
    );
    return Number(reader.getRowObjects()[0]?.c ?? 0);
  } catch {
    return null;
  }
}
