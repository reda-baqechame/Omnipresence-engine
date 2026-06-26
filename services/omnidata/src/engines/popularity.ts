/**
 * Popularity Index (OmniData side) - honest relative popularity (0-100),
 * never absolute traffic. Blends OpenPageRank + Common Crawl referring domains
 * + crawl breadth from the existing domain-analytics engine.
 */
import { runDomainAnalytics } from "./domain-analytics.js";

export interface PopularityResult {
  domain: string;
  score: number;
  components: { page_rank: number; referring_domains: number; crawl_pages: number };
  signals: string[];
  note: string;
}

function logScore(value: number, scale: number): number {
  return Math.max(0, Math.min(100, Math.round(Math.log10(value + 1) * scale)));
}

export async function runPopularity(domain: string): Promise<PopularityResult> {
  const a = await runDomainAnalytics(domain);
  const signals: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (typeof a.page_rank === "number" && a.page_rank > 0) {
    parts.push({ value: Math.min(100, a.page_rank * 10), weight: 0.5 });
    signals.push("openpagerank");
  }
  if (a.referring_domains > 0) {
    parts.push({ value: logScore(a.referring_domains, 33), weight: 0.4 });
    signals.push("common_crawl");
  }
  if (a.crawl_pages > 0) {
    parts.push({ value: Math.min(100, a.crawl_pages * 4), weight: 0.1 });
    signals.push("on_page_crawl");
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = totalWeight > 0
    ? Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight)
    : 0;

  return {
    domain: a.domain,
    score,
    components: {
      page_rank: a.page_rank ?? 0,
      referring_domains: a.referring_domains,
      crawl_pages: a.crawl_pages,
    },
    signals,
    note: "Relative Popularity Index (0-100) from public signals - not an absolute visit count.",
  };
}
