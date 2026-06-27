import { getMultiSourceSuggestions, getSuggestions, type SuggestSource } from "@/lib/providers/autocomplete-multi";
import { getKeywordTrends } from "@/lib/providers/google-trends";
import { classifyIntent, type SearchIntent } from "@/lib/engines/demand-discovery";

/**
 * Keyless keyword universe builder (Phase 11).
 *
 * Fuses multi-source autocomplete (Google/YouTube/Bing/Amazon/Play), alphabet-
 * soup + question/preposition modifier expansion, and Google Trends rising
 * related queries into a deduped, intent-tagged keyword universe. Zero paid keys.
 */

const QUESTION_MODIFIERS = ["how", "what", "why", "when", "where", "who", "which", "can", "are", "is", "will", "does"];
const PREPOSITION_MODIFIERS = ["for", "with", "without", "vs", "versus", "near", "like", "to"];
const COMPARISON_MODIFIERS = ["best", "top", "cheap", "free", "alternative to", "vs"];

export interface UniverseKeyword {
  keyword: string;
  intent: SearchIntent;
  sources: string[];
  isQuestion: boolean;
  rising: boolean;
}

export interface KeywordUniverse {
  available: boolean;
  seed: string;
  total: number;
  keywords: UniverseKeyword[];
  byIntent: Record<SearchIntent, number>;
  questions: string[];
}

function isQuestion(k: string): boolean {
  const first = k.trim().toLowerCase().split(/\s+/)[0];
  return QUESTION_MODIFIERS.includes(first) || k.trim().endsWith("?");
}

export async function buildKeywordUniverse(input: {
  seed: string;
  geo?: string;
  depth?: "shallow" | "deep";
  sources?: SuggestSource[];
}): Promise<KeywordUniverse> {
  const seed = input.seed.trim().toLowerCase();
  const depth = input.depth || "shallow";
  const sources = input.sources || ["google", "youtube", "bing", "amazon", "play"];

  const map = new Map<string, UniverseKeyword>();
  const add = (keyword: string, source: string, rising = false) => {
    const k = keyword.toLowerCase().trim();
    if (!k || k.length < 2) return;
    const existing = map.get(k);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (rising) existing.rising = true;
      return;
    }
    map.set(k, {
      keyword: k,
      intent: classifyIntent(k),
      sources: [source],
      isQuestion: isQuestion(k),
      rising,
    });
  };

  // 1. Base multi-source suggestions.
  const base = await getMultiSourceSuggestions(seed, sources);
  for (const [src, list] of Object.entries(base.bySource)) {
    for (const k of list) add(k, src);
  }

  // 2. Modifier expansion (alphabet soup + questions + prepositions + comparisons).
  const seeds = depth === "deep" ? deepSeeds(seed) : shallowSeeds(seed);
  const expansionResults = await Promise.all(
    seeds.map(async (s) => {
      const g = await getSuggestions(s, "google").catch(() => []);
      return g;
    })
  );
  expansionResults.flat().forEach((k) => add(k, "google_expanded"));

  // 3. Trends rising related queries.
  try {
    const trends = await getKeywordTrends(seed, input.geo || "US");
    for (const q of trends.related_rising || []) add(q, "trends_rising", true);
    for (const q of trends.related_top || []) add(q, "trends_top");
  } catch {
    // optional
  }

  const keywords = [...map.values()].sort((a, b) => b.sources.length - a.sources.length || a.keyword.localeCompare(b.keyword));

  const byIntent: Record<SearchIntent, number> = {
    informational: 0,
    commercial: 0,
    transactional: 0,
    navigational: 0,
  };
  for (const k of keywords) byIntent[k.intent] += 1;

  return {
    available: keywords.length > 0,
    seed,
    total: keywords.length,
    keywords,
    byIntent,
    questions: keywords.filter((k) => k.isQuestion).map((k) => k.keyword).slice(0, 50),
  };
}

function shallowSeeds(seed: string): string[] {
  return [
    ...QUESTION_MODIFIERS.map((m) => `${m} ${seed}`),
    ...PREPOSITION_MODIFIERS.map((m) => `${seed} ${m}`),
    ...COMPARISON_MODIFIERS.map((m) => `${m} ${seed}`),
  ];
}

function deepSeeds(seed: string): string[] {
  const alpha = "abcdefghijklmnopqrstuvwxyz".split("").map((c) => `${seed} ${c}`);
  return [...shallowSeeds(seed), ...alpha];
}
