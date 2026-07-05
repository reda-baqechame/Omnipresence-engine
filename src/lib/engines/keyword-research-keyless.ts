import { getMultiSourceSuggestions } from "@/lib/providers/autocomplete-multi";
import { getTrendsComparison } from "@/lib/providers/google-trends";
import {
  getKeywordDataBatch,
  hasKeywordsEverywhereCapability,
} from "@/lib/providers/keywords-everywhere";
import type { LiveKeywordRow } from "@/lib/providers/intelligence-api";

const MODIFIERS = ["best", "top", "how to", "vs", "review", "cheap", "near me", "alternative"];

/**
 * Keyless keyword research when OmniData/DataForSEO unavailable.
 * Autocomplete fan-out + Trends indices — always labeled estimated/low confidence.
 */
export async function researchKeywordsKeyless(seed: string): Promise<{
  seed: string;
  suggestions: LiveKeywordRow[];
  related: LiveKeywordRow[];
  data_source: "keyword_planner" | "estimated";
} | null> {
  const base = seed.trim().toLowerCase();
  if (!base) return null;

  const all = new Set<string>();
  const seeds = [base, ...MODIFIERS.map((m) => `${m} ${base}`)];
  for (const s of seeds) {
    const multi = await getMultiSourceSuggestions(s, ["google", "youtube", "bing", "amazon"]);
    for (const k of multi.unique) all.add(k);
  }

  const keywords = [...all].slice(0, 40);
  if (!keywords.length) return null;

  const trends = await getTrendsComparison(keywords.slice(0, 5), "US");

  const volumeMap = new Map<string, number>();
  if (hasKeywordsEverywhereCapability()) {
    for (let i = 0; i < keywords.length; i += 100) {
      const chunk = keywords.slice(i, i + 100);
      const batch = await getKeywordDataBatch(chunk);
      if (batch.success && batch.data) {
        for (const row of batch.data) volumeMap.set(row.keyword.toLowerCase(), row.volume);
      }
    }
  }

  const hasLiveVolume = volumeMap.size > 0;
  const rowSource = hasLiveVolume ? "keywords_everywhere" : "autocomplete_multi";
  const rowDataSource = hasLiveVolume ? ("keyword_planner" as const) : ("estimated" as const);

  const toRow = (keyword: string): LiveKeywordRow => ({
    keyword,
    volume_estimate: volumeMap.get(keyword.toLowerCase()),
    trend_index: trends?.get(keyword),
    data_source: rowDataSource,
    source: rowSource,
  });

  const suggestions: LiveKeywordRow[] = keywords.slice(0, 20).map(toRow);
  const related: LiveKeywordRow[] = keywords.slice(20).map(toRow);

  return { seed: base, suggestions, related, data_source: rowDataSource };
}
