/**
 * Trend discovery via Google Trends daily RSS (no API key required).
 */

export interface TrendSignal {
  title: string;
  traffic?: string;
  publishedAt?: string;
  newsUrl?: string;
  viralScore: number;
}

function parseRssItems(xml: string): TrendSignal[] {
  const items: TrendSignal[] = [];
  const blocks = xml.split("<item>").slice(1);

  for (const block of blocks) {
    const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || block.match(/<title>(.*?)<\/title>/)?.[1];
    if (!title) continue;

    const traffic = block.match(/<ht:approx_traffic><!\[CDATA\[(.*?)\]\]><\/ht:approx_traffic>/)?.[1]
      || block.match(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/)?.[1];
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
    const link = block.match(/<link>(.*?)<\/link>/)?.[1];

    const trafficNum = traffic ? parseInt(traffic.replace(/[^0-9]/g, ""), 10) : 0;
    const viralScore = Math.min(100, Math.max(20, Math.round(Math.log10(trafficNum + 10) * 25)));

    items.push({
      title: title.trim(),
      traffic,
      publishedAt: pubDate,
      newsUrl: link,
      viralScore,
    });
  }

  return items.sort((a, b) => b.viralScore - a.viralScore);
}

export async function fetchDailyTrends(geo = "US"): Promise<TrendSignal[]> {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PresenceOS-Trends/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml).slice(0, 25);
  } catch {
    return [];
  }
}

export function matchTrendsToIndustry(trends: TrendSignal[], industry: string, limit = 10): TrendSignal[] {
  const tokens = industry.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  if (!tokens.length) return trends.slice(0, limit);

  const scored = trends.map((t) => {
    const lower = t.title.toLowerCase();
    const hits = tokens.filter((tok) => lower.includes(tok)).length;
    return { trend: t, score: t.viralScore + hits * 20 };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.trend);
}

export function trendToContentTopic(trend: TrendSignal, brandName: string, industry: string): string {
  return `${trend.title}: what ${brandName} customers in ${industry} should know`;
}
