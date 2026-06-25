import type { KeywordSuggestion } from "../types.js";

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

export async function runKeywords(seed: string): Promise<{
  seed: string;
  suggestions: KeywordSuggestion[];
  related: KeywordSuggestion[];
}> {
  const autocomplete = await googleAutocomplete(seed);
  const relatedSeeds = autocomplete.slice(0, 3);
  const relatedLists = await Promise.all(relatedSeeds.map((s) => googleAutocomplete(s)));
  const relatedFlat = [...new Set(relatedLists.flat())]
    .filter((k) => k !== seed && !autocomplete.includes(k))
    .slice(0, 20);

  const seedSerpCount = await serpResultCountEstimate(seed);

  const suggestions = clusterKeywords(autocomplete).map((s, idx) => ({
    ...s,
    volume_estimate: estimateVolume(
      s.keyword,
      autocomplete.indexOf(s.keyword) >= 0 ? autocomplete.indexOf(s.keyword) : idx,
      autocomplete.filter((k) => k.startsWith(s.keyword.split(" ")[0])).length,
      s.keyword === seed ? seedSerpCount : undefined
    ),
  }));

  const related = relatedFlat.map((keyword, idx) => ({
    keyword,
    source: "related" as const,
    volume_estimate: estimateVolume(keyword, idx, 1),
  }));

  return { seed, suggestions, related };
}
