import type { KeywordSuggestion } from "../types.js";
import { getKeywordMetrics, hasKeywordPlanner, type KeywordMetricsOptions } from "./keyword-planner.js";
import { getTrendsComparison } from "./trends.js";

const SERPER_KEY = process.env.SERPER_API_KEY;

async function googleAutocomplete(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[]];
    return data[1] || [];
  } catch {
    return [];
  }
}

/** Estimate relative search demand from autocomplete rank + SERP signals (not random). */
function estimateVolume(
  keyword: string,
  autocompleteIndex: number,
  relatedClusterSize: number,
  serpResultCount?: number
): number {
  const positionScore = Math.max(100, 8000 - autocompleteIndex * 350);
  const clusterBoost = Math.min(relatedClusterSize * 40, 600);
  const words = keyword.trim().split(/\s+/).length;
  const tailFactor = words >= 5 ? 0.35 : words >= 3 ? 0.65 : 1;
  const serpBoost = serpResultCount
    ? Math.min(Math.log10(Math.max(serpResultCount, 10)) * 200, 1200)
    : 0;
  return Math.round((positionScore + clusterBoost + serpBoost) * tailFactor);
}

async function serpResultCountEstimate(keyword: string): Promise<number | undefined> {
  if (!SERPER_KEY) return undefined;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: keyword, num: 10 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { organic?: unknown[]; searchParameters?: { q?: string } };
    const organic = data.organic?.length ?? 0;
    return organic > 0 ? organic * 1_000_000 : undefined;
  } catch {
    return undefined;
  }
}

function clusterKeywords(suggestions: string[]): KeywordSuggestion[] {
  const clusters = new Map<string, string[]>();
  for (const s of suggestions) {
    const root = s.split(" ")[0]?.toLowerCase() || s;
    const list = clusters.get(root) || [];
    list.push(s);
    clusters.set(root, list);
  }
  const out: KeywordSuggestion[] = [];
  for (const [, group] of clusters) {
    for (let i = 0; i < group.length; i++) {
      const kw = group[i];
      out.push({
        keyword: kw,
        source: group.length > 1 ? "cluster" : "autocomplete",
        volume_estimate: estimateVolume(kw, i, group.length),
      });
    }
  }
  return out;
}

export async function runKeywords(
  seed: string,
  plannerOptions?: KeywordMetricsOptions
): Promise<{
  seed: string;
  suggestions: KeywordSuggestion[];
  related: KeywordSuggestion[];
  data_source: "keyword_planner" | "trends_estimated" | "estimated";
}> {
  const autocomplete = await googleAutocomplete(seed);
  const relatedSeeds = autocomplete.slice(0, 3);
  const relatedLists = await Promise.all(relatedSeeds.map((s) => googleAutocomplete(s)));
  const relatedFlat = [...new Set(relatedLists.flat())]
    .filter((k) => k !== seed && !autocomplete.includes(k))
    .slice(0, 20);

  const seedSerpCount = await serpResultCountEstimate(seed);

  let suggestions: KeywordSuggestion[] = clusterKeywords(autocomplete).map((s, idx) => ({
    ...s,
    volume_estimate: estimateVolume(
      s.keyword,
      autocomplete.indexOf(s.keyword) >= 0 ? autocomplete.indexOf(s.keyword) : idx,
      autocomplete.filter((k) => k.startsWith(s.keyword.split(" ")[0])).length,
      s.keyword === seed ? seedSerpCount : undefined
    ),
    data_source: "estimated" as const,
  }));

  let related: KeywordSuggestion[] = relatedFlat.map((keyword, idx) => ({
    keyword,
    source: "related" as const,
    volume_estimate: estimateVolume(keyword, idx, 1),
    data_source: "estimated" as const,
  }));

  // Upgrade to REAL volume + CPC via Google Ads Keyword Planner when configured.
  let dataSource: "keyword_planner" | "trends_estimated" | "estimated" = "estimated";
  if (hasKeywordPlanner(plannerOptions?.creds)) {
    const allKeywords = [
      seed,
      ...suggestions.map((s) => s.keyword),
      ...related.map((r) => r.keyword),
    ];
    const metrics = await getKeywordMetrics(allKeywords, plannerOptions);
    if (metrics && metrics.length > 0) {
      const byKw = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
      const enrich = (s: KeywordSuggestion): KeywordSuggestion => {
        const m = byKw.get(s.keyword.toLowerCase());
        if (!m) return s;
        return {
          ...s,
          volume_estimate: m.avg_monthly_searches,
          cpc: m.cpc,
          competition: m.competition,
          data_source: "keyword_planner",
        };
      };
      suggestions = suggestions.map(enrich);
      related = related.map(enrich);
      dataSource = "keyword_planner";
    }
  }

  // No real volume? Attach a REAL Google Trends demand index (0-100) to the top
  // keywords in one comparison request. This is relative demand, not volume.
  if (dataSource === "estimated") {
    const top = [...suggestions]
      .sort((a, b) => (b.volume_estimate ?? 0) - (a.volume_estimate ?? 0))
      .slice(0, 5)
      .map((s) => s.keyword);
    const compare = [...new Set([seed, ...top])].slice(0, 5);
    const trendMap = await getTrendsComparison(compare);
    if (trendMap && trendMap.size > 0) {
      const attach = (s: KeywordSuggestion): KeywordSuggestion => {
        const idx = trendMap.get(s.keyword);
        if (idx === undefined) return s;
        return { ...s, trend_index: idx, data_source: "trends_estimated" };
      };
      suggestions = suggestions.map(attach);
      related = related.map(attach);
      dataSource = "trends_estimated";
    }
  }

  return { seed, suggestions, related, data_source: dataSource };
}
