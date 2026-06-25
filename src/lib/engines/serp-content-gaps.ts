/** Content gap analysis from live SERP — competitor ranks, you don't. */

import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

export interface SerpContentGap {
  keyword: string;
  competitor: string;
  competitor_position: number;
  our_position: number | null;
  gap_score: number;
}

function domainInResults(domain: string, urls: string[]): number | null {
  const token = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
  for (let i = 0; i < urls.length; i++) {
    if (urls[i].toLowerCase().includes(token)) return i + 1;
  }
  return null;
}

export async function contentGapsFromSerp(
  domain: string,
  competitors: string[],
  seeds: string[]
): Promise<SerpContentGap[]> {
  const gaps: SerpContentGap[] = [];
  const keywords = [...new Set([...seeds].filter(Boolean))].slice(0, 10);

  for (const keyword of keywords) {
    const res = await searchGoogleOrganicRouter(keyword, "United States", domain, competitors);
    if (!res.success || !res.data?.organicResults?.length) continue;

    const urls = res.data.organicResults.map((r) => r.url);
    const ourPos = domainInResults(domain, urls);

    for (const comp of competitors.slice(0, 3)) {
      const compToken = comp.toLowerCase().replace(/\s+/g, "");
      const compPos = urls.findIndex((u) => u.toLowerCase().includes(compToken));
      if (compPos >= 0 && compPos < 10 && (ourPos === null || ourPos > compPos + 3)) {
        gaps.push({
          keyword,
          competitor: comp,
          competitor_position: compPos + 1,
          our_position: ourPos,
          gap_score: Math.min(100, 90 - compPos * 5 + (ourPos ? 0 : 20)),
        });
      }
    }
  }

  return gaps.sort((a, b) => b.gap_score - a.gap_score).slice(0, 25);
}
