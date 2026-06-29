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

/**
 * Map a Common Crawl harmonic-centrality rank position to a 0..100 authority
 * score (lower position = more authoritative). Pure + log-scaled so the top
 * domains compress near 100 and the long tail spreads out — comparable in
 * spirit to DR/DA without the paid index. `total` defaults to the ~100M domains
 * in a recent crawl.
 */
export function normalizeAuthority(rankPosition: number, total = 100_000_000): number {
  if (!Number.isFinite(rankPosition) || rankPosition <= 0) return 0;
  const clamped = Math.min(rankPosition, total);
  const score = 100 * (1 - Math.log10(clamped) / Math.log10(total));
  return Math.max(0, Math.min(100, Math.round(score)));
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
    // Authority ranks (harmonic centrality + pagerank) — the part that lets us
    // attach a real, free authority score to every referring domain. Best-effort:
    // a missing/changed ranks file must not fail the core vertices/edges ingest.
    try {
      await conn.run(
        `CREATE OR REPLACE TABLE ranks AS
           SELECT CAST(column0 AS BIGINT) AS harmonic_pos,
                  CAST(column1 AS DOUBLE) AS harmonic_val,
                  CAST(column2 AS BIGINT) AS pr_pos,
                  CAST(column3 AS DOUBLE) AS pr_val,
                  column4 AS rev_host
           FROM read_csv('${base}-ranks.txt.gz', delim=' ', header=false,
                         columns={'column0':'VARCHAR','column1':'VARCHAR','column2':'VARCHAR','column3':'VARCHAR','column4':'VARCHAR'});`
      );
      await conn.run("CREATE INDEX IF NOT EXISTS idx_ranks_host ON ranks(rev_host);");
    } catch (e) {
      console.warn(`[webgraph] ranks ingest skipped: ${e instanceof Error ? e.message : "unknown"}`);
    }
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

export interface WebgraphMeta {
  release: string | null;
  ingested_at: string | null;
  vertex_count: number;
  edge_count: number;
}

/** Freshness/provenance metadata for the currently-ingested webgraph. */
export async function getWebgraphMeta(): Promise<WebgraphMeta | null> {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const reader = await conn.runAndReadAll(
      "SELECT release, CAST(ingested_at AS VARCHAR) AS ingested_at, vertex_count, edge_count FROM meta LIMIT 1"
    );
    const row = reader.getRowObjects()[0];
    if (!row) return { release: null, ingested_at: null, vertex_count: 0, edge_count: 0 };
    return {
      release: row.release != null ? String(row.release) : null,
      ingested_at: row.ingested_at != null ? String(row.ingested_at) : null,
      vertex_count: Number(row.vertex_count ?? 0),
      edge_count: Number(row.edge_count ?? 0),
    };
  } catch {
    return null;
  }
}

// In-process guard so a re-ingest trigger can't stack multiple multi-GB jobs.
let ingestInFlight = false;

/** Whether an ingest is currently running in this process. */
export function isIngestInFlight(): boolean {
  return ingestInFlight;
}

/**
 * Fire-and-forget re-ingest used by the scheduled refresh endpoint. Returns
 * immediately with whether the job was accepted; the heavy work runs in the
 * background. Concurrent triggers are rejected while one is in flight.
 */
export function triggerIngestAsync(release: string): { accepted: boolean; reason?: string } {
  if (ingestInFlight) return { accepted: false, reason: "ingest already in progress" };
  let rel: string;
  try {
    rel = sanitizeRelease(release);
  } catch (e) {
    return { accepted: false, reason: e instanceof Error ? e.message : "invalid release" };
  }
  ingestInFlight = true;
  void ingestWebgraph(rel)
    .then((r) => {
      if (!r.ok) console.warn(`[webgraph] re-ingest failed: ${r.message}`);
      else console.log(`[webgraph] re-ingest complete: ${r.message}`);
    })
    .catch((e) => console.warn("[webgraph] re-ingest error", e))
    .finally(() => {
      ingestInFlight = false;
    });
  return { accepted: true };
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

export interface DomainAuthority {
  host: string;
  harmonic_pos: number | null;
  pr_pos: number | null;
  /** 0..100 authority score derived from harmonic centrality rank. */
  authority: number;
}

/**
 * Real domain authority from the Common Crawl rank index — the free replacement
 * for DataForSEO/Ahrefs DR. Returns null when ranks aren't ingested (caller
 * falls back to OpenPageRank/Tranco).
 */
export async function getDomainAuthority(host: string): Promise<DomainAuthority | null> {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const rev = sanitizeRevHost(reverseHost(host));
    const reader = await conn.runAndReadAll(
      `SELECT harmonic_pos, pr_pos FROM ranks WHERE rev_host = '${rev}' LIMIT 1;`
    );
    const row = reader.getRowObjects()[0];
    if (!row) return null;
    const harmonicPos = row.harmonic_pos != null ? Number(row.harmonic_pos) : null;
    const prPos = row.pr_pos != null ? Number(row.pr_pos) : null;
    return {
      host: host.replace(/^www\./, ""),
      harmonic_pos: harmonicPos,
      pr_pos: prPos,
      authority: harmonicPos != null ? normalizeAuthority(harmonicPos) : 0,
    };
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
