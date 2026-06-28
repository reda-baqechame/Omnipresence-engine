/**
 * Crawl → Citation correlation — the loop no competitor closes.
 *
 * Agent Analytics tells you who CRAWLS you; the visibility scanner tells you who
 * CITES you. Joining them per engine reveals the actionable diagnosis:
 *   - Crawling AND citing      → working, protect it.
 *   - Crawling, NOT citing     → they read you but don't trust/use you → AEO /
 *                                 content-quality gap (the fixable, high-value one).
 *   - NOT crawling             → access/discovery gap (robots.txt, firewall,
 *                                 internal links, freshness) — they can't cite
 *                                 what they never fetch.
 *   - Citing without observed crawl → cited from training data or a crawl that
 *                                 predates your logs; keep feeding logs.
 */

import type { VisibilityResult, VisibilityEngine } from "@/types/database";
import type { CrawlerHit } from "@/lib/engines/agent-analytics";

export type CorrelationStatus =
  | "crawling_and_citing"
  | "crawling_not_citing"
  | "not_crawling"
  | "citing_no_crawl";

export interface CorrelationRow {
  engine: VisibilityEngine;
  engineLabel: string;
  vendor: string;
  crawls: number;
  lastCrawl: string | null;
  probes: number;
  citations: number;
  citationRate: number;
  mentioned: number;
  status: CorrelationStatus;
  insight: string;
}

// Which AI crawler vendor feeds which answer engine we actually scan.
const VENDOR_TO_ENGINES: Array<{ vendor: string; engines: VisibilityEngine[]; label: string }> = [
  { vendor: "OpenAI", engines: ["chatgpt"], label: "ChatGPT" },
  { vendor: "Anthropic", engines: ["claude"], label: "Claude" },
  { vendor: "Perplexity", engines: ["perplexity"], label: "Perplexity" },
  { vendor: "Google", engines: ["google_ai_overview", "gemini"], label: "Google AI" },
  { vendor: "Microsoft", engines: ["bing_copilot"], label: "Copilot" },
];

function statusInsight(status: CorrelationStatus, vendor: string, label: string): string {
  switch (status) {
    case "crawling_and_citing":
      return `${vendor} crawls your site and cites you in ${label}. This loop is working — keep your top-cited pages fresh.`;
    case "crawling_not_citing":
      return `${vendor} actively crawls you but you're not cited in ${label}. Your pages are readable but not winning the answer — strengthen entity clarity, direct answers, and schema on the relevant pages.`;
    case "not_crawling":
      return `No ${vendor} crawls recorded. ${label} can't cite content it never fetches — check robots.txt / firewall for its agent, add internal links, and publish fresh, linkable pages.`;
    case "citing_no_crawl":
      return `You're cited in ${label} without an observed ${vendor} crawl in this window — likely from training data or an earlier crawl. Keep feeding logs to confirm ongoing access.`;
  }
}

export function correlateCrawlsToCitations(
  hits: CrawlerHit[],
  results: VisibilityResult[]
): CorrelationRow[] {
  // Crawl tallies per vendor.
  const crawlByVendor = new Map<string, { count: number; last: string | null }>();
  for (const h of hits) {
    const cur = crawlByVendor.get(h.vendor) || { count: 0, last: null };
    cur.count += 1;
    if (!cur.last || h.hit_at > cur.last) cur.last = h.hit_at;
    crawlByVendor.set(h.vendor, cur);
  }

  // Citation tallies per engine.
  const byEngine = new Map<string, { probes: number; citations: number; mentioned: number }>();
  for (const r of results) {
    const cur = byEngine.get(r.engine) || { probes: 0, citations: 0, mentioned: 0 };
    cur.probes += 1;
    if (r.brand_cited) cur.citations += 1;
    if (r.brand_mentioned) cur.mentioned += 1;
    byEngine.set(r.engine, cur);
  }

  const rows: CorrelationRow[] = [];

  for (const map of VENDOR_TO_ENGINES) {
    const crawl = crawlByVendor.get(map.vendor) || { count: 0, last: null };

    // Aggregate the engines this vendor powers.
    let probes = 0;
    let citations = 0;
    let mentioned = 0;
    for (const eng of map.engines) {
      const e = byEngine.get(eng);
      if (e) {
        probes += e.probes;
        citations += e.citations;
        mentioned += e.mentioned;
      }
    }

    // Skip vendors we neither crawl-tracked nor scanned — nothing to say.
    if (crawl.count === 0 && probes === 0) continue;

    const citationRate = probes > 0 ? citations / probes : 0;
    const isCrawling = crawl.count > 0;
    const isCiting = citations > 0;

    let status: CorrelationStatus;
    if (isCrawling && isCiting) status = "crawling_and_citing";
    else if (isCrawling && !isCiting) status = "crawling_not_citing";
    else if (!isCrawling && isCiting) status = "citing_no_crawl";
    else status = "not_crawling";

    rows.push({
      engine: map.engines[0],
      engineLabel: map.label,
      vendor: map.vendor,
      crawls: crawl.count,
      lastCrawl: crawl.last,
      probes,
      citations,
      citationRate: Math.round(citationRate * 100) / 100,
      mentioned,
      status,
      insight: statusInsight(status, map.vendor, map.label),
    });
  }

  // Surface the most actionable rows first: read-but-not-cited, then no-crawl.
  const priority: Record<CorrelationStatus, number> = {
    crawling_not_citing: 0,
    not_crawling: 1,
    citing_no_crawl: 2,
    crawling_and_citing: 3,
  };
  rows.sort((a, b) => priority[a.status] - priority[b.status] || b.crawls - a.crawls);

  return rows;
}

export function correlationStatusLabel(status: CorrelationStatus): string {
  switch (status) {
    case "crawling_and_citing":
      return "Crawling & citing";
    case "crawling_not_citing":
      return "Crawls, not citing";
    case "not_crawling":
      return "Not crawling";
    case "citing_no_crawl":
      return "Citing (no crawl seen)";
  }
}
