/**
 * Presence Backlink Graph — URL-level, crawl-verified backlinks.
 *
 * The Common Crawl domain webgraph (webgraph.ts) gives REAL referring DOMAINS,
 * but no URL, anchor text, or rel attribute. This engine closes that gap: it
 * seeds candidate referring domains from the webgraph, then crawl-verifies each
 * by fetching the source page(s) and parsing the actual <a> tags that point at
 * the target — capturing source_url, target_url, anchor text, and
 * rel(nofollow/sponsored/ugc). Verified edges are persisted to a DuckDB table so
 * first_seen/last_seen (and new/lost) are tracked across runs.
 *
 * Everything degrades gracefully:
 * - No webgraph index -> no seeds -> empty (caller falls back to summary).
 * - No DuckDB -> no temporal history; rows still returned with first=last=now.
 * - Per-source fetch/parse failures are isolated and never crash the run.
 *
 * Respect target ToS / robots.txt (enforced) and rate limits.
 */
import * as cheerio from "cheerio";
import type { BacklinkLinkRow } from "../types.js";
import { getConnection, getInboundLinks, getDomainAuthorityBatch } from "./webgraph.js";
import { isCrawlAllowed, CRAWLER_UA } from "../robots-guard.js";

const BLOCKED = new Set(["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254"]);

function cleanDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
}

/** SSRF guard mirroring crawler.assertPublicUrl (kept local to avoid a cycle). */
function assertPublicUrl(url: string): URL {
  const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP(S) allowed");
  }
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  if (BLOCKED.has(host) || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) {
    throw new Error("SSRF blocked");
  }
  return parsed;
}

/** Double single-quotes for safe DuckDB string literals (no prepared stmts exposed). */
function sq(v: string): string {
  return `'${String(v).replace(/'/g, "''")}'`;
}

let tableReady = false;
let tableUnavailable = false;

/** Lazily create the persistent URL-level link table; null if DuckDB is absent. */
async function ensureTable(): Promise<Awaited<ReturnType<typeof getConnection>>> {
  if (tableUnavailable) return null;
  const conn = await getConnection();
  if (!conn) {
    tableUnavailable = true;
    return null;
  }
  if (tableReady) return conn;
  try {
    await conn.run(
      `CREATE TABLE IF NOT EXISTS backlink_links (
         target_domain VARCHAR,
         source_url VARCHAR,
         target_url VARCHAR,
         source_domain VARCHAR,
         anchor VARCHAR,
         rel VARCHAR,
         nofollow BOOLEAN,
         sponsored BOOLEAN,
         ugc BOOLEAN,
         http_status INTEGER,
         first_seen TIMESTAMP,
         last_seen TIMESTAMP,
         lost_at TIMESTAMP,
         PRIMARY KEY (source_url, target_url)
       );`
    );
    // Backfill the temporal column for indexes created before lost-tracking.
    try {
      await conn.run("ALTER TABLE backlink_links ADD COLUMN IF NOT EXISTS lost_at TIMESTAMP;");
    } catch {
      /* column already present */
    }
    await conn.run(
      "CREATE INDEX IF NOT EXISTS idx_bl_target ON backlink_links(target_domain);"
    );
    tableReady = true;
    return conn;
  } catch {
    tableUnavailable = true;
    return null;
  }
}

interface ParsedLink {
  source_url: string;
  target_url: string;
  anchor: string;
  rel: string[];
}

/** Parse all <a> in `html` that point at `targetDomain` (or a subdomain). */
export function extractLinksToTarget(html: string, sourceUrl: string, targetDomain: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, sourceUrl);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(abs.protocol)) return;
    const host = abs.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== targetDomain && !host.endsWith(`.${targetDomain}`)) return;
    const relRaw = ($(el).attr("rel") || "").toLowerCase();
    const rel = relRaw.split(/\s+/).filter(Boolean);
    const anchor = $(el).text().replace(/\s+/g, " ").trim().slice(0, 300);
    out.push({ source_url: sourceUrl, target_url: abs.toString(), anchor, rel });
  });
  return out;
}

async function fetchHtml(url: string): Promise<{ html: string | null; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": CRAWLER_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return { html: null, status: res.status };
    const html = await res.text();
    return { html: html.slice(0, 2_000_000), status: res.status };
  } catch {
    return { html: null, status: 0 };
  }
}

type VerifiedEdge = Omit<BacklinkLinkRow, "first_seen" | "last_seen" | "domain_rank">;

/**
 * Crawl-verify a single source domain for links to the target. `fetched` is true
 * only when the source page actually loaded — so a transient fetch failure never
 * causes a real link to be falsely marked "lost".
 */
async function verifySource(
  sourceDomain: string,
  targetDomain: string
): Promise<{ fetched: boolean; rows: VerifiedEdge[] }> {
  const rows: VerifiedEdge[] = [];
  let homeUrl: string;
  try {
    homeUrl = assertPublicUrl(sourceDomain).toString();
  } catch {
    return { fetched: false, rows };
  }
  if (!(await isCrawlAllowed(homeUrl, sourceDomain))) return { fetched: false, rows };

  const { html, status } = await fetchHtml(homeUrl);
  if (!html) return { fetched: false, rows };

  const links = extractLinksToTarget(html, homeUrl, targetDomain);
  for (const l of links) {
    rows.push({
      source_url: l.source_url,
      source_domain: sourceDomain,
      target_url: l.target_url,
      target_domain: targetDomain,
      anchor: l.anchor,
      rel: l.rel,
      nofollow: l.rel.includes("nofollow"),
      sponsored: l.rel.includes("sponsored"),
      ugc: l.rel.includes("ugc"),
      http_status: status,
      verification: "crawl_verified",
    });
  }
  return { fetched: true, rows };
}

// ---------- Spam/toxic + link-value scoring (pure, testable) ----------

const SPAMMY_TLDS = new Set([
  "xyz", "top", "loan", "click", "work", "gq", "ml", "cf", "tk", "ga", "buzz", "country", "kim",
]);

/**
 * Heuristic spam/toxic risk (0-100, higher = riskier) for a referring domain.
 * Pure function: low authority, spammy TLDs, excessive hyphens/length, and
 * nofollow-from-spam patterns raise the score. Not a verdict — a triage signal.
 */
export function spamRiskScore(input: {
  sourceDomain: string;
  authority?: number;
  nofollow?: boolean;
}): number {
  let risk = 0;
  const d = input.sourceDomain.toLowerCase();
  const tld = d.split(".").pop() || "";
  if (SPAMMY_TLDS.has(tld)) risk += 35;
  const labels = d.split(".");
  const sld = labels.length >= 2 ? labels[labels.length - 2] : d;
  const hyphens = (sld.match(/-/g) || []).length;
  if (hyphens >= 3) risk += 20;
  else if (hyphens === 2) risk += 10;
  if (sld.length >= 25) risk += 15;
  if (/\d{3,}/.test(sld)) risk += 10;
  const auth = input.authority ?? 0;
  if (auth === 0) risk += 25;
  else if (auth < 10) risk += 15;
  else if (auth < 25) risk += 5;
  else if (auth >= 60) risk -= 15;
  if (input.nofollow && auth < 20) risk += 5;
  return Math.max(0, Math.min(100, Math.round(risk)));
}

/**
 * Link value (0-100): authority-weighted, dofollow-boosted, spam-penalized.
 * Approximates "how much SEO equity this link likely passes."
 */
export function linkValueScore(input: {
  authority?: number;
  nofollow?: boolean;
  sponsored?: boolean;
  ugc?: boolean;
  spamRisk?: number;
}): number {
  const auth = Math.max(0, Math.min(100, input.authority ?? 0));
  let value = auth * 0.8;
  if (!input.nofollow && !input.sponsored && !input.ugc) value += 20;
  else value *= 0.4; // nofollow/sponsored/ugc pass little-to-no equity
  value -= (input.spamRisk ?? 0) * 0.3;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

const edgeKey = (sourceUrl: string, targetUrl: string) => `${sourceUrl}\u0000${targetUrl}`;

/** Read existing edge keys for a target (to compute new/lost this run). */
async function readExistingKeys(targetDomain: string): Promise<Set<string>> {
  const conn = await ensureTable();
  if (!conn) return new Set();
  try {
    const reader = await conn.runAndReadAll(
      `SELECT source_url, target_url FROM backlink_links WHERE target_domain = ${sq(targetDomain)};`
    );
    const out = new Set<string>();
    for (const r of reader.getRowObjects()) {
      out.add(edgeKey(String(r.source_url), String(r.target_url)));
    }
    return out;
  } catch {
    return new Set();
  }
}

/**
 * Upsert verified edges (first_seen/last_seen, clearing any prior lost_at), then
 * mark as lost any previously-stored edge whose source WAS crawled this run but
 * whose link was not found — the honest live verifier.
 */
async function persistEdges(
  targetDomain: string,
  verified: VerifiedEdge[],
  crawledSources: string[],
  now: string
): Promise<{ persisted: boolean; lostCount: number }> {
  const conn = await ensureTable();
  if (!conn) return { persisted: false, lostCount: 0 };
  try {
    for (const r of verified) {
      await conn.run(
        `INSERT INTO backlink_links
           (target_domain, source_url, target_url, source_domain, anchor, rel,
            nofollow, sponsored, ugc, http_status, first_seen, last_seen, lost_at)
         VALUES (${sq(targetDomain)}, ${sq(r.source_url)}, ${sq(r.target_url)},
                 ${sq(r.source_domain)}, ${sq(r.anchor)}, ${sq(r.rel.join(" "))},
                 ${r.nofollow}, ${r.sponsored}, ${r.ugc}, ${r.http_status},
                 ${sq(now)}, ${sq(now)}, NULL)
         ON CONFLICT (source_url, target_url) DO UPDATE SET
           last_seen = ${sq(now)},
           lost_at = NULL,
           anchor = ${sq(r.anchor)},
           rel = ${sq(r.rel.join(" "))},
           nofollow = ${r.nofollow},
           sponsored = ${r.sponsored},
           ugc = ${r.ugc},
           http_status = ${r.http_status};`
      );
    }

    let lostCount = 0;
    if (crawledSources.length > 0) {
      const inList = Array.from(new Set(crawledSources)).map((s) => sq(s)).join(",");
      // Edges from crawled sources not touched this run (last_seen < now) are lost.
      await conn.run(
        `UPDATE backlink_links SET lost_at = ${sq(now)}
          WHERE target_domain = ${sq(targetDomain)}
            AND source_domain IN (${inList})
            AND last_seen < ${sq(now)}
            AND lost_at IS NULL;`
      );
      try {
        const r = await conn.runAndReadAll(
          `SELECT COUNT(*) AS c FROM backlink_links
            WHERE target_domain = ${sq(targetDomain)} AND lost_at = ${sq(now)};`
        );
        lostCount = Number(r.getRowObjects()[0]?.c ?? 0);
      } catch {
        /* count optional */
      }
    }
    return { persisted: true, lostCount };
  } catch {
    return { persisted: false, lostCount: 0 };
  }
}

/** Read persisted edges (with real first/last seen + lost status) for a target. */
async function readPersisted(targetDomain: string, limit: number): Promise<BacklinkLinkRow[]> {
  const conn = await ensureTable();
  if (!conn) return [];
  try {
    const reader = await conn.runAndReadAll(
      `SELECT source_url, target_url, source_domain, anchor, rel, nofollow, sponsored, ugc,
              http_status, CAST(first_seen AS VARCHAR) AS first_seen,
              CAST(last_seen AS VARCHAR) AS last_seen, CAST(lost_at AS VARCHAR) AS lost_at
         FROM backlink_links
        WHERE target_domain = ${sq(targetDomain)}
        ORDER BY lost_at IS NULL DESC, last_seen DESC
        LIMIT ${Math.max(1, Math.min(limit, 2000))};`
    );
    return reader.getRowObjects().map((r) => {
      const rel = String(r.rel ?? "").split(/\s+/).filter(Boolean);
      const lost = r.lost_at != null && String(r.lost_at).length > 0;
      return {
        source_url: String(r.source_url),
        source_domain: String(r.source_domain),
        target_url: String(r.target_url),
        target_domain: targetDomain,
        anchor: String(r.anchor ?? ""),
        rel,
        nofollow: Boolean(r.nofollow),
        sponsored: Boolean(r.sponsored),
        ugc: Boolean(r.ugc),
        http_status: Number(r.http_status ?? 0),
        first_seen: String(r.first_seen),
        last_seen: String(r.last_seen),
        verification: lost ? ("lost" as const) : ("crawl_verified" as const),
      };
    });
  } catch {
    return [];
  }
}

export interface BacklinkGraphLinkScored extends BacklinkLinkRow {
  spam_risk: number;
  link_value: number;
}

export interface BacklinkGraphResult {
  target: string;
  total_links: number;
  referring_domains: number;
  nofollow_count: number;
  dofollow_count: number;
  /** Links first confirmed this run (vs. the persisted history). */
  new_count: number;
  /** Previously-seen links that disappeared from re-crawled sources this run. */
  lost_count: number;
  /** Links flagged spam_risk >= 60 — review before trusting. */
  toxic_count: number;
  /** "crawl_verified" when live verification produced edges; "candidate" when only webgraph seeds exist. */
  data_source: "crawl_verified" | "candidate" | "unavailable";
  persisted: boolean;
  items: BacklinkGraphLinkScored[];
}

/**
 * Build the URL-level Presence Backlink Graph for a target domain.
 *
 * @param target       target domain or URL
 * @param maxSources   max referring domains to crawl-verify this run (cost cap)
 */
export async function runBacklinkGraph(
  target: string,
  maxSources = 40
): Promise<BacklinkGraphResult> {
  const targetDomain = cleanDomain(target);
  const now = new Date().toISOString();

  // 1) Seed candidate referring domains from the real Common Crawl webgraph.
  const seeds = (await getInboundLinks(targetDomain, Math.max(maxSources, 1))) || [];
  const sourceDomains = seeds.map((s) => s.source_domain).filter((d) => d && d !== targetDomain);

  // Existing edge keys (before this run) to compute new vs. recurring.
  const existingKeys = await readExistingKeys(targetDomain);

  // 2) Crawl-verify each source: find live <a> with anchor + rel to the target.
  const verifiedNested = await mapLimit(sourceDomains.slice(0, maxSources), 6, (sd) =>
    verifySource(sd, targetDomain)
  );
  const verified = verifiedNested.flatMap((v) => v.rows);
  const crawledSources = sourceDomains
    .slice(0, maxSources)
    .filter((_, i) => verifiedNested[i]?.fetched);

  const newCount = verified.filter(
    (r) => !existingKeys.has(edgeKey(r.source_url, r.target_url))
  ).length;

  // 3) Persist for temporal history + mark lost, then read back the merged graph.
  const { persisted, lostCount } = await persistEdges(targetDomain, verified, crawledSources, now);

  let baseItems: BacklinkLinkRow[];
  if (persisted) {
    baseItems = await readPersisted(targetDomain, 2000);
  } else {
    // No DuckDB: return this run's verified edges with first=last=now.
    baseItems = verified.map((r) => ({ ...r, first_seen: now, last_seen: now }));
  }

  // 4) Attach free Common Crawl authority + spam/value scores to each edge.
  const hosts = Array.from(new Set(baseItems.map((r) => r.source_domain)));
  const authority = hosts.length > 0 ? await getDomainAuthorityBatch(hosts) : new Map<string, number>();
  const items: BacklinkGraphLinkScored[] = baseItems.map((r) => {
    const domainRank = authority.get(r.source_domain);
    const spam = spamRiskScore({ sourceDomain: r.source_domain, authority: domainRank, nofollow: r.nofollow });
    const value = linkValueScore({
      authority: domainRank,
      nofollow: r.nofollow,
      sponsored: r.sponsored,
      ugc: r.ugc,
      spamRisk: spam,
    });
    return { ...r, domain_rank: domainRank, spam_risk: spam, link_value: value };
  });
  // Most valuable, live links first.
  items.sort((a, b) => {
    if ((a.verification === "lost") !== (b.verification === "lost")) {
      return a.verification === "lost" ? 1 : -1;
    }
    return b.link_value - a.link_value;
  });

  const liveItems = items.filter((r) => r.verification !== "lost");
  const referringDomains = new Set(liveItems.map((r) => r.source_domain)).size;
  const nofollowCount = liveItems.filter((r) => r.nofollow).length;
  const toxicCount = liveItems.filter((r) => r.spam_risk >= 60).length;

  const dataSource: BacklinkGraphResult["data_source"] =
    verified.length > 0 || liveItems.length > 0
      ? "crawl_verified"
      : sourceDomains.length > 0
        ? "candidate"
        : "unavailable";

  return {
    target: targetDomain,
    total_links: liveItems.length,
    referring_domains: referringDomains,
    nofollow_count: nofollowCount,
    dofollow_count: liveItems.length - nofollowCount,
    new_count: newCount,
    lost_count: lostCount,
    toxic_count: toxicCount,
    data_source: dataSource,
    persisted,
    items: items.slice(0, 1000),
  };
}

// ---------- Competitor link intersection ----------

export interface LinkIntersectionRow {
  source_domain: string;
  /** Which of the provided competitor domains this source links to. */
  links_to: string[];
  count: number;
  authority: number | null;
  /** True when the source links to >=minOverlap competitors but NOT the brand. */
  brand_gap: boolean;
}

export interface LinkIntersectionResult {
  target: string;
  competitors: string[];
  min_overlap: number;
  data_source: "commoncrawl_webgraph" | "unavailable";
  rows: LinkIntersectionRow[];
}

/**
 * Competitor link intersection ("links to N+ competitors"). Uses the real Common
 * Crawl referring-domain sets for the brand + each competitor, then surfaces
 * source domains that link to >=minOverlap competitors — prioritising those that
 * do NOT yet link to the brand (the highest-leverage outreach targets).
 */
export async function runLinkIntersection(
  target: string,
  competitors: string[],
  minOverlap = 2,
  perDomainLimit = 200
): Promise<LinkIntersectionResult> {
  const targetDomain = cleanDomain(target);
  const compDomains = Array.from(
    new Set(competitors.map((c) => cleanDomain(c)).filter((d) => d && d !== targetDomain))
  );

  const [brandInbound, ...compInbound] = await Promise.all([
    getInboundLinks(targetDomain, perDomainLimit),
    ...compDomains.map((c) => getInboundLinks(c, perDomainLimit)),
  ]);

  const anyData =
    brandInbound != null || compInbound.some((c) => c != null);
  if (!anyData) {
    return { target: targetDomain, competitors: compDomains, min_overlap: minOverlap, data_source: "unavailable", rows: [] };
  }

  const brandLinkers = new Set((brandInbound || []).map((l) => l.source_domain));
  const linkers = new Map<string, Set<string>>();
  compInbound.forEach((inbound, i) => {
    const comp = compDomains[i];
    for (const l of inbound || []) {
      if (l.source_domain === targetDomain) continue;
      const set = linkers.get(l.source_domain) || new Set<string>();
      set.add(comp);
      linkers.set(l.source_domain, set);
    }
  });

  const candidates = Array.from(linkers.entries())
    .map(([sourceDomain, comps]) => ({ sourceDomain, comps }))
    .filter((c) => c.comps.size >= minOverlap);

  const authority = await getDomainAuthorityBatch(candidates.map((c) => c.sourceDomain));

  const rows: LinkIntersectionRow[] = candidates
    .map((c) => ({
      source_domain: c.sourceDomain,
      links_to: Array.from(c.comps),
      count: c.comps.size,
      authority: authority.get(c.sourceDomain) ?? null,
      brand_gap: !brandLinkers.has(c.sourceDomain),
    }))
    .sort((a, b) => {
      if (a.brand_gap !== b.brand_gap) return a.brand_gap ? -1 : 1;
      if (b.count !== a.count) return b.count - a.count;
      return (b.authority ?? 0) - (a.authority ?? 0);
    });

  return {
    target: targetDomain,
    competitors: compDomains,
    min_overlap: minOverlap,
    data_source: "commoncrawl_webgraph",
    rows: rows.slice(0, 500),
  };
}
