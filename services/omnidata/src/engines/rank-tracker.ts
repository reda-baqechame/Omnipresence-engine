import { runSerpLive, findDomainPosition } from "./serp.js";
import {
  appendRankHistory,
  detectCannibalization,
  getRankHistory,
  strikingDistance,
} from "../store.js";
import type { RankSnapshot } from "../types.js";

export async function runRankCheck(
  keyword: string,
  domain: string,
  location = "United States"
): Promise<{
  snapshot: RankSnapshot;
  history: Array<{ checked_at: string; position: number | null; features: string[] }>;
  striking_distance: boolean;
  cannibalization_urls: string[];
}> {
  const serp = await runSerpLive(keyword, location);
  const items = serp.tasks[0]?.result[0]?.items || [];
  const { position, url, features } = findDomainPosition(items, domain);
  const checked_at = new Date().toISOString();

  const snapshot: RankSnapshot = {
    keyword,
    domain,
    position,
    url,
    serp_features: features,
    checked_at,
  };

  const key = `${domain}::${keyword}`;
  appendRankHistory(key, { checked_at, position, features });
  const history = getRankHistory(key);

  const cannibalization_urls = detectCannibalization(
    items
      .filter((i) => i.type === "organic")
      .map((i) => ({ url: i.url, position: i.rank_absolute ?? null }))
  );

  return {
    snapshot,
    history,
    striking_distance: strikingDistance(history),
    cannibalization_urls,
  };
}

export async function scheduleRankChecks(
  keywords: string[],
  domain: string,
  location = "United States"
): Promise<RankSnapshot[]> {
  const results: RankSnapshot[] = [];
  for (const keyword of keywords) {
    const r = await runRankCheck(keyword, domain, location);
    results.push(r.snapshot);
  }
  return results;
}
