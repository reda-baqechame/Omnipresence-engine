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

import { unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

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

async function resetWebgraphDb(): Promise<void> {
  cachedConn = null;
  duckUnavailable = false;
  const dataDir = dirname(DB_PATH);
  const base = DB_PATH.split(/[/\\]/).pop() || "webgraph.duckdb";
  try {
    const { readdir, rm } = await import("node:fs/promises");
    for (const f of await readdir(dataDir)) {
      if (
        f.startsWith("webgraph") ||
        f.startsWith(base) ||
        f.endsWith(".part") ||
        f.endsWith(".duckdb") ||
        f.endsWith(".wal") ||
        f.endsWith(".tmp")
      ) {
        await rm(join(dataDir, f), { force: true, recursive: true });
      }
    }
  } catch {
    try {
      unlinkSync(DB_PATH);
      unlinkSync(`${DB_PATH}.wal`);
    } catch {
      /* fresh ingest */
    }
  }
}

/** Wipe persisted webgraph files (used on startup when volume is corrupted/full). */
export async function wipeWebgraphStorage(): Promise<void> {
  await resetWebgraphDb();
}

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

// Exported so the integration test can seed a synthetic graph through the very
// same connection the query helpers use (proving the real query SQL, not a mock).
export async function getConnection(): Promise<DuckDBConnection | null> {
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

function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function openGzipLineStream(url: string): Promise<AsyncIterable<string>> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const webBody = res.body as import("stream/web").ReadableStream<Uint8Array>;
  const input = Readable.fromWeb(webBody).pipe(createGunzip());
  return createInterface({ input, crlfDelay: Infinity });
}

/** Stream vertex file into DuckDB without staging gzip on disk. */
async function streamVerticesFromGzipUrl(conn: DuckDBConnection, url: string): Promise<void> {
  console.log("[webgraph] streaming vertices…");
  await conn.run("CREATE OR REPLACE TABLE vertices(id BIGINT, rev_host VARCHAR);");
  const rl = await openGzipLineStream(url);
  let batch: string[] = [];
  let lines = 0;
  for await (const line of rl) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const id = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const tab2 = rest.indexOf("\t");
    const rev = tab2 >= 0 ? rest.slice(0, tab2) : rest;
    if (!id || !rev) continue;
    batch.push(`(${id},${sqlStr(rev)})`);
    lines++;
    if (batch.length >= 50_000) {
      await conn.run(`INSERT INTO vertices VALUES ${batch.join(",")};`);
      batch = [];
    }
  }
  if (batch.length) await conn.run(`INSERT INTO vertices VALUES ${batch.join(",")};`);
  console.log(`[webgraph] vertices complete: ${lines.toLocaleString()} lines`);
}

/** Stream multi-GB edge files into DuckDB without staging the full gzip on disk. */
async function streamEdgesFromGzipUrl(conn: DuckDBConnection, url: string): Promise<void> {
  console.log("[webgraph] streaming edges…");
  await conn.run("CREATE OR REPLACE TABLE edges(from_id BIGINT, to_id BIGINT);");
  const rl = await openGzipLineStream(url);
  let batch: string[] = [];
  let lines = 0;
  for await (const line of rl) {
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const from = line.slice(0, tab);
    const to = line.slice(tab + 1);
    if (!from || !to) continue;
    batch.push(`(${from},${to})`);
    lines++;
    if (batch.length >= 50_000) {
      await conn.run(`INSERT INTO edges VALUES ${batch.join(",")};`);
      batch = [];
      if (lines % 5_000_000 === 0) console.log(`[webgraph] edges streamed: ${lines.toLocaleString()} lines`);
    }
  }
  if (batch.length) await conn.run(`INSERT INTO edges VALUES ${batch.join(",")};`);
  console.log(`[webgraph] edges complete: ${lines.toLocaleString()} lines`);
}

/** Stream ranks (best-effort authority index). */
async function streamRanksFromGzipUrl(conn: DuckDBConnection, url: string): Promise<void> {
  console.log("[webgraph] streaming ranks…");
  await conn.run(
    "CREATE OR REPLACE TABLE ranks(harmonic_pos BIGINT, harmonic_val DOUBLE, pr_pos BIGINT, pr_val DOUBLE, rev_host VARCHAR);"
  );
  const rl = await openGzipLineStream(url);
  let batch: string[] = [];
  let lines = 0;
  for await (const line of rl) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const [hPos, hVal, prPos, prVal, rev] = parts;
    if (!rev || !hPos) continue;
    batch.push(`(${hPos},${hVal},${prPos},${prVal},${sqlStr(rev)})`);
    lines++;
    if (batch.length >= 50_000) {
      await conn.run(`INSERT INTO ranks VALUES ${batch.join(",")};`);
      batch = [];
    }
  }
  if (batch.length) await conn.run(`INSERT INTO ranks VALUES ${batch.join(",")};`);
  console.log(`[webgraph] ranks complete: ${lines.toLocaleString()} lines`);
}

/** Build the DuckDB index from a Common Crawl domain webgraph release (heavy, one-time). */
export async function ingestWebgraph(release: string): Promise<{ ok: boolean; message: string }> {
  await resetWebgraphDb();
  const conn = await getConnection();
  if (!conn) return { ok: false, message: "DuckDB unavailable (install @duckdb/node-api)" };

  const rel = sanitizeRelease(release);
  const base = `${CC_BASE}/${rel}/domain/${rel}-domain`;
  const mode = (process.env.WEBGRAPH_INGEST_MODE || "full").toLowerCase();

  try {
    if (mode === "ranks-only") {
      console.log("[webgraph] ranks-only mode (fits 5GB Railway volume — authority index, no backlink edges)");
      await streamRanksFromGzipUrl(conn, `${base}-ranks.txt.gz`);
      await conn.run("CREATE INDEX IF NOT EXISTS idx_ranks_host ON ranks(rev_host);");
      const r = await conn.runAndReadAll("SELECT COUNT(*) AS c FROM ranks");
      const rankCount = Number(r.getRowObjects()[0]?.c ?? 0);
      if (rankCount === 0) {
        return { ok: false, message: `Ranks ingest empty for release "${rel}"` };
      }
      await conn.run(
        `CREATE OR REPLACE TABLE meta AS SELECT '${rel}' AS release, now() AS ingested_at,
           ${rankCount} AS vertex_count, 0 AS edge_count;`
      );
      return {
        ok: true,
        message: `Ingested ${rel} (ranks-only): ${rankCount.toLocaleString()} ranked domains — backlink edges skipped (resize volume to 20GB+ for full graph)`,
      };
    }

    await streamVerticesFromGzipUrl(conn, `${base}-vertices.txt.gz`);
    await streamEdgesFromGzipUrl(conn, `${base}-edges.txt.gz`);
    await conn.run("CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);");

    try {
      await streamRanksFromGzipUrl(conn, `${base}-ranks.txt.gz`);
      await conn.run("CREATE INDEX IF NOT EXISTS idx_ranks_host ON ranks(rev_host);");
    } catch (e) {
      console.warn(`[webgraph] ranks ingest skipped: ${e instanceof Error ? e.message : "unknown"}`);
    }
    await conn.run(
      `CREATE OR REPLACE TABLE meta AS SELECT '${rel}' AS release, now() AS ingested_at,
         (SELECT COUNT(*) FROM vertices) AS vertex_count,
         (SELECT COUNT(*) FROM edges) AS edge_count;`
    );
    // Validate the ingest actually loaded data so a wrong release id / changed
    // file layout fails loudly instead of leaving an empty "ready" index.
    const meta = await getWebgraphMeta();
    const vtx = meta?.vertex_count ?? 0;
    const edg = meta?.edge_count ?? 0;
    let rankCount = 0;
    try {
      const r = await conn.runAndReadAll("SELECT COUNT(*) AS c FROM ranks");
      rankCount = Number(r.getRowObjects()[0]?.c ?? 0);
    } catch {
      /* ranks optional */
    }
    if (vtx === 0 || edg === 0) {
      return {
        ok: false,
        message: `Ingest produced an empty index (vertices=${vtx}, edges=${edg}). Check the release id "${rel}" exists at ${CC_BASE}/${rel}/domain/.`,
      };
    }
    return {
      ok: true,
      message: `Ingested ${rel}: ${vtx.toLocaleString()} domains, ${edg.toLocaleString()} edges, ${rankCount.toLocaleString()} ranks${rankCount === 0 ? " (authority unavailable — ranks file missing/changed)" : ""}`,
    };
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
let lastIngestError: string | null = null;

/** Whether an ingest is currently running in this process. */
export function isIngestInFlight(): boolean {
  return ingestInFlight;
}

export function getLastIngestError(): string | null {
  return lastIngestError;
}

/** True when @duckdb/node-api loaded successfully in this process. */
export function isDuckDbAvailable(): boolean {
  return !duckUnavailable;
}

/** Live table row counts (even before meta is written). */
export async function getLiveWebgraphCounts(): Promise<{ vertices: number; edges: number } | null> {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const v = await conn.runAndReadAll("SELECT COUNT(*) AS c FROM vertices");
    const e = await conn.runAndReadAll("SELECT COUNT(*) AS c FROM edges");
    return {
      vertices: Number(v.getRowObjects()[0]?.c ?? 0),
      edges: Number(e.getRowObjects()[0]?.c ?? 0),
    };
  } catch {
    return null;
  }
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
  lastIngestError = null;
  void ingestWebgraph(rel)
    .then((r) => {
      if (!r.ok) {
        lastIngestError = r.message;
        console.warn(`[webgraph] re-ingest failed: ${r.message}`);
      } else {
        console.log(`[webgraph] re-ingest complete: ${r.message}`);
      }
    })
    .catch((e) => {
      lastIngestError = e instanceof Error ? e.message : String(e);
      console.warn("[webgraph] re-ingest error", e);
    })
    .finally(() => {
      ingestInFlight = false;
    });
  return { accepted: true };
}

export async function isWebgraphReady(): Promise<boolean> {
  if (isIngestInFlight()) return false;
  const conn = await getConnection();
  if (!conn) return false;
  try {
    const reader = await conn.runAndReadAll(
      "SELECT vertex_count, edge_count FROM meta LIMIT 1"
    );
    const row = reader.getRowObjects()[0];
    if (!row) return false;
    const vtx = Number(row.vertex_count ?? 0);
    const edg = Number(row.edge_count ?? 0);
    if (edg > 0) return vtx > 0 && edg > 0;
    // ranks-only index: authority works; backlink edge queries stay unavailable.
    try {
      const ranks = await conn.runAndReadAll("SELECT COUNT(*) AS c FROM ranks");
      return Number(ranks.getRowObjects()[0]?.c ?? 0) > 0;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/** True when the full edge graph (referring domains) is queryable, not just ranks. */
export async function isWebgraphEdgesReady(): Promise<boolean> {
  if (isIngestInFlight()) return false;
  const meta = await getWebgraphMeta();
  return Boolean(meta && meta.edge_count > 0 && meta.vertex_count > 0);
}

/** Real inbound links (referring domains) for a host from the webgraph index. */
export async function getInboundLinks(host: string, limit = 100): Promise<InboundLink[] | null> {
  const conn = await getConnection();
  if (!conn) return null;
  if (!(await isWebgraphEdgesReady())) return null;

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

/**
 * Batch Common Crawl authority (0-100 by harmonic-centrality rank) for many hosts
 * in a single query — the free DR replacement used to score every referring
 * domain at once. Hosts missing from the rank index are simply absent from the map.
 */
export async function getDomainAuthorityBatch(hosts: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const conn = await getConnection();
  if (!conn || hosts.length === 0) return out;
  try {
    const revs = Array.from(new Set(hosts))
      .map((h) => {
        try {
          return sanitizeRevHost(reverseHost(h.replace(/^www\./, "")));
        } catch {
          return null;
        }
      })
      .filter((r): r is string => Boolean(r));
    if (revs.length === 0) return out;
    const inList = revs.map((r) => `'${r}'`).join(",");
    const reader = await conn.runAndReadAll(
      `SELECT rev_host, harmonic_pos FROM ranks WHERE rev_host IN (${inList});`
    );
    for (const row of reader.getRowObjects()) {
      const pos = row.harmonic_pos != null ? Number(row.harmonic_pos) : null;
      if (pos != null) out.set(unreverseHost(String(row.rev_host)), normalizeAuthority(pos));
    }
  } catch {
    /* ranks table not ingested or query failed — caller falls back to OPR */
  }
  return out;
}

/** Total referring-domain count for a host (cheaper than fetching the list). */
export async function getReferringDomainCount(host: string): Promise<number | null> {
  const conn = await getConnection();
  if (!conn) return null;
  if (!(await isWebgraphEdgesReady())) return null;
  try {
    const rev = sanitizeRevHost(reverseHost(host));
    const reader = await conn.runAndReadAll(
      `SELECT COUNT(DISTINCT e.from_id) AS c
         FROM edges e
         JOIN vertices v1 ON v1.id = e.to_id
         JOIN vertices v2 ON v2.id = e.from_id
        WHERE v1.rev_host = '${rev}' AND v2.rev_host <> '${rev}';`
    );
    return Number(reader.getRowObjects()[0]?.c ?? 0);
  } catch {
    return null;
  }
}
