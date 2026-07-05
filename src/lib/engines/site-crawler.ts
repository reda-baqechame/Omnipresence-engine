import { assertPublicDomain } from "@/lib/security/domain";
import { crawlViaOmniData } from "@/lib/security/engine-auth";
import { isCrawlAllowed } from "@/lib/crawl/robots-guard";
import type { FindingSeverity } from "@/types/database";
import type { TechnicalAuditFinding } from "@/lib/engines/technical-audit";

export interface CrawlPageResult {
  url: string;
  status: number;
  title?: string;
  links: string[];
  simhash: string;
  pagerank: number;
}

function simhash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function computePageRank(pages: CrawlPageResult[]): Map<string, number> {
  const n = pages.length;
  const ranks = new Map(pages.map((p) => [p.url, 1 / Math.max(n, 1)]));
  const outLinks = new Map(
    pages.map((p) => [p.url, p.links.filter((l) => pages.some((x) => x.url === l))])
  );

  for (let iter = 0; iter < 10; iter++) {
    const next = new Map<string, number>();
    for (const page of pages) {
      let sum = 0;
      for (const other of pages) {
        const links = outLinks.get(other.url) || [];
        if (links.includes(page.url)) {
          sum += (ranks.get(other.url) || 0) / Math.max(links.length, 1);
        }
      }
      next.set(page.url, 0.15 / Math.max(n, 1) + 0.85 * sum);
    }
    for (const [url, rank] of next) ranks.set(url, rank);
  }
  return ranks;
}

async function crawlLocal(
  startUrl: string,
  maxPages: number
): Promise<{ pages: CrawlPageResult[]; duplicate_clusters: Array<{ simhash: string; urls: string[] }> }> {
  const start = new URL(startUrl.startsWith("http") ? startUrl : `https://${startUrl}`);
  assertPublicDomain(start.hostname);
  const domain = start.hostname.replace(/^www\./, "");
  const robotsAllowed = await isCrawlAllowed(start.toString(), domain);
  if (!robotsAllowed) {
    return { pages: [], duplicate_clusters: [] };
  }

  // Seed queue from sitemap when available (deeper, sitemap-driven crawl).
  const sitemapUrls = await discoverSitemapUrls(start.toString(), domain, maxPages);
  const visited = new Set<string>();
  const queue = sitemapUrls.length ? sitemapUrls : [start.toString()];
  const pages: CrawlPageResult[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const allowed = await isCrawlAllowed(url, domain);
      if (!allowed) continue;

      const res = await fetch(url, {
        headers: { "User-Agent": "PresenceOS-Crawler/1.0" },
        signal: AbortSignal.timeout(10000),
      });
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = titleMatch?.[1]?.trim();
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 5000);
      const linkRe = /href=["']([^"']+)["']/gi;
      const links: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(html))) {
        try {
          const abs = new URL(m[1], url);
          const h = abs.hostname.replace(/^www\./, "");
          if (h !== domain && !h.endsWith(`.${domain}`)) continue;
          assertPublicDomain(h);
          links.push(abs.toString());
          if (!visited.has(abs.toString())) queue.push(abs.toString());
        } catch {
          // skip
        }
      }
      pages.push({
        url,
        status: res.status,
        title,
        links: [...new Set(links)],
        simhash: simhash(text),
        pagerank: 0,
      });
    } catch {
      pages.push({ url, status: 0, links: [], simhash: "", pagerank: 0 });
    }
  }

  const pr = computePageRank(pages);
  for (const p of pages) p.pagerank = pr.get(p.url) || 0;

  const groups = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.simhash) continue;
    const g = groups.get(p.simhash) || [];
    g.push(p.url);
    groups.set(p.simhash, g);
  }

  return {
    pages,
    duplicate_clusters: [...groups.entries()]
      .filter(([, urls]) => urls.length > 1)
      .map(([h, urls]) => ({ simhash: h, urls })),
  };
}

export async function runSiteCrawl(
  domain: string,
  maxPages = 100
): Promise<{
  pages: CrawlPageResult[];
  duplicate_clusters: Array<{ simhash: string; urls: string[] }>;
  source: "omnidata" | "local";
}> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  assertPublicDomain(new URL(baseUrl).hostname);

  const remote = await crawlViaOmniData(baseUrl, maxPages);
  if (remote?.pages?.length) {
    return {
      pages: remote.pages.map((p) => ({
        url: p.url,
        status: p.status,
        title: p.title,
        links: p.links || [],
        simhash: p.simhash,
        pagerank: p.pagerank,
      })),
      duplicate_clusters: remote.duplicate_clusters,
      source: "omnidata",
    };
  }

  const local = await crawlLocal(baseUrl, maxPages);
  return { ...local, source: "local" };
}

export function crawlFindingsToTechnical(
  crawl: Awaited<ReturnType<typeof runSiteCrawl>>
): TechnicalAuditFinding[] {
  const findings: TechnicalAuditFinding[] = [];

  const errors = crawl.pages.filter((p) => p.status >= 400 || p.status === 0);
  if (errors.length > 0) {
    findings.push({
      category: "crawl_coverage",
      severity: "high" as FindingSeverity,
      title: `${errors.length} pages returned errors during crawl`,
      description: `Crawled ${crawl.pages.length} pages; ${errors.length} had HTTP errors.`,
      impact: "Broken pages reduce indexable surface area.",
      fix_recommendation: "Fix 4xx/5xx responses on internal URLs.",
    });
  }

  for (const cluster of crawl.duplicate_clusters) {
    findings.push({
      category: "duplicate_content",
      severity: "medium" as FindingSeverity,
      title: "Near-duplicate page cluster detected",
      description: `${cluster.urls.length} URLs share similar content (SimHash ${cluster.simhash}).`,
      impact: "Duplicate clusters dilute ranking signals.",
      fix_recommendation: "Consolidate or canonicalize duplicate URLs.",
      affected_url: cluster.urls[0],
    });
  }

  const lowPr = crawl.pages.filter((p) => p.pagerank < 0.01 && p.status === 200);
  if (lowPr.length > 3) {
    findings.push({
      category: "internal_linking",
      severity: "medium" as FindingSeverity,
      title: `${lowPr.length} orphan/low-authority pages`,
      description: "Several crawled pages have very low internal PageRank.",
      impact: "Important pages may not receive enough internal link equity.",
      fix_recommendation: "Add contextual internal links from high-authority pages.",
    });
  }

  return findings;
}

async function discoverSitemapUrls(startUrl: string, domain: string, max: number): Promise<string[]> {
  const candidates = [
    new URL("/sitemap.xml", startUrl).toString(),
    new URL("/sitemap_index.xml", startUrl).toString(),
  ];
  const out: string[] = [];
  for (const sm of candidates) {
    try {
      const allowed = await isCrawlAllowed(sm, domain);
      if (!allowed) continue;
      const res = await fetch(sm, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const locRe = /<loc>([^<]+)<\/loc>/gi;
      let m: RegExpExecArray | null;
      while ((m = locRe.exec(xml)) && out.length < max) {
        const u = m[1].trim();
        try {
          const h = new URL(u).hostname.replace(/^www\./, "");
          if (h === domain || h.endsWith(`.${domain}`)) out.push(u);
        } catch {
          /* skip */
        }
      }
      if (out.length) break;
    } catch {
      /* try next */
    }
  }
  return [...new Set(out)].slice(0, max);
}
