import { runSerpLive, findDomainPosition } from "./serp.js";
import { runKeywords } from "./keywords.js";

export interface ContentGapRow {
  keyword: string;
  competitor_domain: string;
  competitor_position: number;
  our_position: number | null;
  volume_estimate?: number;
  intent?: string;
  opportunity_score: number;
}

/**
 * Content gap: keywords where competitors rank top-10 but brand does not.
 * Mirrors DataForSEO Labs ranked_keywords gap pattern using live SERP.
 */
export async function findContentGaps(
  domain: string,
  competitors: string[],
  seeds: string[]
): Promise<ContentGapRow[]> {
  const brand = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const compClean = competitors
    .map((c) => c.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
    .filter((c) => c && c !== brand);

  const keywordSet = new Set<string>();
  for (const seed of seeds.slice(0, 5)) {
    const kw = await runKeywords(seed);
    for (const s of [...kw.suggestions, ...kw.related].slice(0, 12)) {
      keywordSet.add(s.keyword);
    }
    keywordSet.add(seed);
  }

  const gaps: ContentGapRow[] = [];
  const seen = new Set<string>();

  for (const keyword of [...keywordSet].slice(0, 25)) {
    const serp = await runSerpLive(keyword);
    const items = serp.tasks[0]?.result?.[0]?.items || [];
    const our = findDomainPosition(items, brand);

    for (const comp of compClean) {
      const compPos = findDomainPosition(items, comp);
      if (!compPos.position || compPos.position > 10) continue;
      if (our.position && our.position <= 10) continue;

      const key = `${keyword}::${comp}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const opportunity_score = Math.min(
        100,
        (11 - compPos.position) * 8 + (our.position ? 10 : 25) + (items.some((i) => i.type === "ai_overview") ? 8 : 0)
      );

      gaps.push({
        keyword,
        competitor_domain: comp,
        competitor_position: compPos.position,
        our_position: our.position,
        opportunity_score,
      });
    }
  }

  return gaps.sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 50);
}
