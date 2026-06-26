import { runBacklinks } from "./backlinks.js";
import { runKeywords } from "./keywords.js";
import { crawlSite } from "./crawler.js";

const OPR_KEY = process.env.OPENPAGERANK_API_KEY;

async function fetchOpenPageRank(domain: string): Promise<number | undefined> {
  if (!OPR_KEY) return undefined;
  try {
    const res = await fetch(
      `https://openpagerank.com/api/v1.0/getPageRank?domains[]=${encodeURIComponent(domain)}`,
      { headers: { "API-OPR": OPR_KEY } }
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      response?: Array<{ domain: string; page_rank_integer?: number }>;
    };
    return data.response?.[0]?.page_rank_integer;
  } catch {
    return undefined;
  }
}

export async function runDomainAnalytics(domain: string): Promise<{
  domain: string;
  page_rank?: number;
  backlinks_total: number;
  referring_domains: number;
  top_keywords: Array<{ keyword: string; volume_estimate?: number }>;
  crawl_pages: number;
  sources: string[];
}> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const sources: string[] = [];

  const [backlinks, keywords, crawl, opr] = await Promise.all([
    runBacklinks(clean),
    runKeywords(clean.split(".")[0]),
    crawlSite(`https://${clean}`, { maxPages: 10 }).catch(() => null),
    fetchOpenPageRank(clean),
  ]);

  if (backlinks.items?.length) sources.push("common_crawl", "link_serp");
  if (keywords.suggestions.length) sources.push("google_autocomplete");
  if (crawl?.pages.length) sources.push("on_page_crawl");
  if (opr !== undefined) sources.push("openpagerank");

  const referring = new Set(
    (backlinks.items || []).map((b) => b.source_domain).filter(Boolean)
  );

  return {
    domain: clean,
    page_rank: opr,
    backlinks_total: backlinks.total_count ?? backlinks.items?.length ?? 0,
    referring_domains: backlinks.referring_domains ?? referring.size,
    top_keywords: keywords.suggestions.slice(0, 10).map((k) => ({
      keyword: k.keyword,
      volume_estimate: k.volume_estimate,
    })),
    crawl_pages: crawl?.pages.length ?? 0,
    sources,
  };
}

export async function runInstantPage(url: string): Promise<{
  url: string;
  status: number;
  title?: string;
  meta_description?: string;
  h1?: string;
  schema_types: string[];
  word_count: number;
  internal_links: number;
  images_without_alt: number;
}> {
  const crawl = await crawlSite(url, { maxPages: 1 });
  const page = crawl.pages[0];
  if (!page) {
    return {
      url,
      status: 0,
      schema_types: [],
      word_count: 0,
      internal_links: 0,
      images_without_alt: 0,
    };
  }

  let meta = "";
  let h1 = "";
  let schemaTypes: string[] = [];
  let imagesWithoutAlt = 0;
  let wordCount = 0;
  try {
    const res = await fetch(page.url, {
      headers: { "User-Agent": "OmniData-Instant/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
    h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/i)?.[1]?.trim() || "";
    const ldMatches = html.matchAll(/"@type"\s*:\s*"([^"]+)"/g);
    schemaTypes = [...new Set([...ldMatches].map((m) => m[1]))];
    const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)];
    imagesWithoutAlt = imgTags.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");
    wordCount = text.split(/\s+/).filter(Boolean).length;
  } catch {
    // partial data from crawl title only
  }

  return {
    url: page.url,
    status: page.status,
    title: page.title,
    meta_description: meta,
    h1,
    schema_types: schemaTypes,
    word_count: wordCount,
    internal_links: page.links?.length ?? 0,
    images_without_alt: imagesWithoutAlt,
  };
}
