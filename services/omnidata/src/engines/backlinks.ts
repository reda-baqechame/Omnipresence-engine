import type { BacklinkRow } from "../types.js";
import { runSerpLive } from "./serp.js";
import { getInboundLinks } from "./webgraph.js";

const OPR_KEY = process.env.OPENPAGERANK_API_KEY;

/** Batch-fetch real domain ratings (0-100) from OpenPageRank (<=100 domains/call). */
async function fetchOpenPageRankBatch(domains: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!OPR_KEY || domains.length === 0) return out;
  const unique = Array.from(new Set(domains)).slice(0, 100);
  try {
    const params = unique
      .map((d) => `domains[]=${encodeURIComponent(d)}`)
      .join("&");
    const res = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?${params}`, {
      headers: { "API-OPR": OPR_KEY },
    });
    if (!res.ok) return out;
    const data = (await res.json()) as {
      response?: Array<{ domain: string; page_rank_integer?: number }>;
    };
    for (const r of data.response || []) {
      if (typeof r.page_rank_integer === "number") {
        // OpenPageRank returns 0-10; scale to a 0-100 domain rating.
        out.set(r.domain, Math.round(r.page_rank_integer * 10));
      }
    }
  } catch {
    /* ignore — DR is optional enrichment */
  }
  return out;
}

/** Real referring domains from the Common Crawl webgraph index. */
async function fetchWebgraphBacklinks(domain: string): Promise<BacklinkRow[]> {
  const inbound = await getInboundLinks(domain, 100);
  if (!inbound) return [];
  const now = new Date().toISOString();
  return inbound.map((l) => ({
    source_url: `https://${l.source_domain}`,
    source_domain: l.source_domain,
    target_url: `https://${domain}`,
    anchor: "",
    last_seen: now,
    source: "webgraph" as const,
    link_count: l.link_count,
  }));
}

/**
 * Fallback only: the `link:` operator is deprecated and approximate. Rows are
 * flagged source="link_operator" so callers can label them "estimated".
 */
async function fetchLinkOperatorBacklinks(domain: string): Promise<BacklinkRow[]> {
  const serp = await runSerpLive(`link:${domain}`);
  const items = serp.tasks[0]?.result[0]?.items || [];
  const now = new Date().toISOString();
  return items
    .filter((i) => i.type === "organic" && i.url)
    .map((i) => {
      let sourceDomain = "";
      try {
        sourceDomain = new URL(i.url!).hostname.replace(/^www\./, "");
      } catch {
        sourceDomain = "";
      }
      return {
        source_url: i.url!,
        source_domain: sourceDomain,
        target_url: `https://${domain}`,
        anchor: i.title || "",
        last_seen: now,
        source: "link_operator" as const,
      };
    })
    .filter((r) => r.source_domain && r.source_domain !== domain);
}

export async function runBacklinks(target: string): Promise<{
  target: string;
  total_count: number;
  referring_domains: number;
  domain_rank?: number;
  /** "webgraph" = real Common Crawl edges; "estimated" = link: operator fallback. */
  data_source: "webgraph" | "estimated";
  items: BacklinkRow[];
}> {
  const domain = target.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

  let rows = await fetchWebgraphBacklinks(domain);
  let dataSource: "webgraph" | "estimated" = "webgraph";

  // Only hit the deprecated link: operator if the real index returned nothing.
  if (rows.length === 0) {
    rows = await fetchLinkOperatorBacklinks(domain);
    dataSource = "estimated";
  }

  const seen = new Set<string>();
  const merged: BacklinkRow[] = [];
  for (const row of rows) {
    const key = row.source_domain;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  // Real DR for the target + each referring domain (one batched OpenPageRank call).
  const drMap = await fetchOpenPageRankBatch([domain, ...merged.map((r) => r.source_domain)]);
  for (const row of merged) {
    const rdr = drMap.get(row.source_domain);
    if (rdr !== undefined) row.domain_rank = rdr;
  }

  const referringDomains = new Set(merged.map((r) => r.source_domain).filter(Boolean));

  return {
    target: domain,
    total_count: merged.reduce((sum, r) => sum + (r.link_count ?? 1), 0),
    referring_domains: referringDomains.size,
    domain_rank: drMap.get(domain),
    data_source: dataSource,
    items: merged.slice(0, 100),
  };
}
