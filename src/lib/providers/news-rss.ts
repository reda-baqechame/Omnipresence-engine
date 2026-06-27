import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * Google News RSS — keyless news search. No API key, no quota gymnastics.
 * Returns recent news items matching a query. Parsed with a small, dependency-
 * free RSS reader (no rss-parser needed) to keep the bundle lean.
 */

export interface NewsItem {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
}

export function hasNewsRssCapability(): boolean {
  return true; // keyless
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeEntities(m[1]) : undefined;
}

export async function searchGoogleNews(
  query: string,
  options: { lang?: string; country?: string; max?: number } = {}
): Promise<{ available: boolean; reason?: string; items: NewsItem[] }> {
  const q = query.trim();
  if (!q) return { available: false, reason: "Empty query", items: [] };

  const lang = options.lang || "en-US";
  const country = options.country || "US";
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=${country}&ceid=${country}:${lang.split("-")[0]}`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "PresenceOS/1.0" },
      timeoutMs: 15_000,
    });
    if (!res.ok) return { available: false, reason: `Google News ${res.status}`, items: [] };
    const xml = await res.text();
    const items: NewsItem[] = [];
    const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    for (const b of blocks.slice(0, options.max ?? 40)) {
      const block = b[1];
      const title = tag(block, "title");
      const link = tag(block, "link");
      if (!title || !link) continue;
      items.push({
        title,
        url: link,
        source: tag(block, "source"),
        publishedAt: tag(block, "pubDate"),
      });
    }
    return { available: true, items };
  } catch (error) {
    logProviderError("news-rss", error, { query: q });
    return { available: false, reason: error instanceof Error ? error.message : "Google News failed", items: [] };
  }
}
