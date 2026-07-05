/** Content gap analysis from live SERP — competitor ranks, you don't. */

import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

/** Canonical shape for DB upsert and UI consumers. */
export interface ContentGapRow {
  keyword: string;
  competitor_domain: string;
  competitor_position: number;
  our_position: number | null;
  opportunity_score: number;
  source: "omnidata_serp" | "serp_router";
}

/** Internal SERP engine row (legacy field names). */
export interface SerpContentGap {
  keyword: string;
  competitor: string;
  competitor_position: number;
  our_position: number | null;
  gap_score: number;
}

/** Normalize any gap row (SERP or OmniData) to the canonical DB shape. */
export function normalizeContentGaps(
  gaps: unknown[],
  source: ContentGapRow["source"] = "serp_router"
): ContentGapRow[] {
  const out: ContentGapRow[] = [];
  for (const raw of gaps) {
    if (!raw || typeof raw !== "object") continue;
    const g = raw as Record<string, unknown>;
    const keyword = String(g.keyword || "").trim();
    if (!keyword) continue;
    const competitor_domain = String(
      g.competitor_domain ?? g.competitor ?? g.competitorDomain ?? ""
    ).trim();
    if (!competitor_domain) continue;
    const competitor_position = Number(g.competitor_position ?? g.competitorPosition ?? 0);
    const our_position =
      g.our_position === null || g.our_position === undefined
        ? null
        : Number(g.our_position);
    const opportunity_score = Number(
      g.opportunity_score ?? g.gap_score ?? g.opportunityScore ?? 0
    );
    out.push({
      keyword,
      competitor_domain,
      competitor_position: Number.isFinite(competitor_position) ? competitor_position : 0,
      our_position: our_position != null && Number.isFinite(our_position) ? our_position : null,
      opportunity_score: Number.isFinite(opportunity_score) ? opportunity_score : 0,
      source,
    });
  }
  return out.sort((a, b) => b.opportunity_score - a.opportunity_score);
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
  seeds: string[],
  maxKeywords = 50
): Promise<ContentGapRow[]> {
  const gaps: SerpContentGap[] = [];
  const keywords = [...new Set([...seeds].filter(Boolean))].slice(0, maxKeywords);

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

  return normalizeContentGaps(
    gaps.sort((a, b) => b.gap_score - a.gap_score).slice(0, 25),
    "serp_router"
  );
}
