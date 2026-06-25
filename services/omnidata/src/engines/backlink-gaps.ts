import { runBacklinks } from "./backlinks.js";

export interface BacklinkGapRow {
  source_domain: string;
  links_competitors: string[];
  opportunity_score: number;
}

/** Referring domains that link to competitors but not to the brand domain. */
export async function findBacklinkGaps(
  domain: string,
  competitors: string[]
): Promise<BacklinkGapRow[]> {
  const brand = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const compList = competitors
    .map((c) => c.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
    .filter((c) => c && c !== brand)
    .slice(0, 5);

  const [brandLinks, ...compResults] = await Promise.all([
    runBacklinks(brand),
    ...compList.map((c) => runBacklinks(c)),
  ]);

  const brandSources = new Set(
    (brandLinks.items || []).map((b) => b.source_domain?.toLowerCase()).filter(Boolean)
  );

  const gapMap = new Map<string, Set<string>>();

  compResults.forEach((result, idx) => {
    const comp = compList[idx];
    for (const row of result.items || []) {
      const src = row.source_domain?.toLowerCase();
      if (!src || brandSources.has(src)) continue;
      const set = gapMap.get(src) || new Set();
      set.add(comp);
      gapMap.set(src, set);
    }
  });

  return [...gapMap.entries()]
    .map(([source_domain, comps]) => ({
      source_domain,
      links_competitors: [...comps],
      opportunity_score: Math.min(100, comps.size * 20 + 20),
    }))
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 40);
}
