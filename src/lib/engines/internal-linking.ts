import { runSiteCrawl, type CrawlPageResult } from "@/lib/engines/site-crawler";

export interface InternalLinkOpportunity {
  sourceUrl: string;
  targetUrl: string;
  anchorSuggestion: string;
  relevanceScore: number;
  contextSnippet?: string;
}

const COMMERCIAL_HINTS = [
  "service",
  "pricing",
  "contact",
  "book",
  "quote",
  "buy",
  "shop",
  "product",
  "solution",
  "about",
];

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isCommercialUrl(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return COMMERCIAL_HINTS.some((h) => path.includes(h));
}

function suggestAnchor(target: CrawlPageResult): string {
  if (target.title) return target.title.slice(0, 60);
  const slug = new URL(target.url).pathname.split("/").filter(Boolean).pop();
  return slug?.replace(/-/g, " ") || "learn more";
}

/**
 * Find internal link opportunities: high-PageRank sources → low-PageRank commercial targets.
 */
export function findInternalLinkOpportunities(
  pages: CrawlPageResult[],
  maxOpportunities = 30
): InternalLinkOpportunity[] {
  const live = pages.filter((p) => p.status === 200 && p.title);
  if (live.length < 2) return [];

  const sorted = [...live].sort((a, b) => b.pagerank - a.pagerank);
  const sources = sorted.slice(0, Math.ceil(sorted.length * 0.4));
  const targets = sorted
    .filter((p) => p.pagerank < 0.02 || isCommercialUrl(p.url))
    .sort((a, b) => a.pagerank - b.pagerank);

  const opportunities: InternalLinkOpportunity[] = [];
  const used = new Set<string>();

  for (const target of targets) {
    const targetTokens = tokenize(`${target.title} ${new URL(target.url).pathname}`);
    for (const source of sources) {
      if (source.url === target.url) continue;
      if (source.links?.length && !source.links.includes(target.url)) {
        // Prefer pages that don't already link to target
      }
      const key = `${source.url}::${target.url}`;
      if (used.has(key)) continue;

      const sourceTokens = tokenize(`${source.title} ${new URL(source.url).pathname}`);
      const relevance = Math.round(jaccard(sourceTokens, targetTokens) * 100);
      const prBoost = Math.round((source.pagerank - target.pagerank) * 200);
      const score = Math.min(100, Math.max(10, relevance + prBoost + (isCommercialUrl(target.url) ? 15 : 0)));

      if (score < 25) continue;

      used.add(key);
      opportunities.push({
        sourceUrl: source.url,
        targetUrl: target.url,
        anchorSuggestion: suggestAnchor(target),
        relevanceScore: score,
        contextSnippet: source.title,
      });

      if (opportunities.length >= maxOpportunities) {
        return opportunities.sort((a, b) => b.relevanceScore - a.relevanceScore);
      }
    }
  }

  return opportunities.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export async function analyzeInternalLinks(
  domain: string,
  maxPages = 40
): Promise<{ opportunities: InternalLinkOpportunity[]; pagesCrawled: number }> {
  const crawl = await runSiteCrawl(domain, maxPages);
  const opportunities = findInternalLinkOpportunities(crawl.pages);
  return { opportunities, pagesCrawled: crawl.pages.length };
}
