import type { KeywordSuggestion } from "../types.js";

async function googleAutocomplete(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[]];
    return data[1] || [];
  } catch {
    return [];
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
    for (const kw of group) {
      out.push({
        keyword: kw,
        source: group.length > 1 ? "cluster" : "autocomplete",
        volume_estimate: Math.max(10, 100 - group.indexOf(kw) * 5),
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
  const related = [...new Set(relatedLists.flat())]
    .filter((k) => k !== seed && !autocomplete.includes(k))
    .slice(0, 20)
    .map((keyword) => ({
      keyword,
      source: "related" as const,
      volume_estimate: 50,
    }));

  const suggestions = clusterKeywords(autocomplete);

  return { seed, suggestions, related };
}
