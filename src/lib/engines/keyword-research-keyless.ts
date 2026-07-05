import { getMultiSourceSuggestions } from "@/lib/providers/autocomplete-multi";
import { getTrendsComparison } from "@/lib/providers/google-trends";
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
  data_source: "estimated";
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
  const suggestions: LiveKeywordRow[] = keywords.slice(0, 20).map((keyword) => ({
    keyword,
    trend_index: trends?.get(keyword),
    data_source: "estimated",
    source: "autocomplete_multi",
  }));
  const related: LiveKeywordRow[] = keywords.slice(20).map((keyword) => ({
    keyword,
    trend_index: trends?.get(keyword),
    data_source: "estimated",
    source: "autocomplete_multi",
  }));

  return { seed: base, suggestions, related, data_source: "estimated" };
}
