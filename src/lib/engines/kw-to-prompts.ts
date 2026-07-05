/**
 * Otterly-style: convert keyword seeds into conversational buyer prompts.
 */
import { getMultiSourceSuggestions } from "@/lib/providers/autocomplete-multi";

const CONVERSATIONAL_PREFIXES = [
  "what is the best",
  "which",
  "how do I choose",
  "compare",
  "recommend",
  "top rated",
];

export async function keywordsToConversationalPrompts(
  seeds: string[],
  opts: { max?: number; industry?: string } = {}
): Promise<Array<{ text: string; source: string; priority: number }>> {
  const max = opts.max ?? 30;
  const out: Array<{ text: string; source: string; priority: number }> = [];
  const seen = new Set<string>();

  for (const seed of seeds.slice(0, 10)) {
    const multi = await getMultiSourceSuggestions(seed, ["google", "youtube"]);
    for (const kw of multi.unique.slice(0, 8)) {
      for (const prefix of CONVERSATIONAL_PREFIXES.slice(0, 2)) {
        const text = `${prefix} ${kw}?`.replace(/\s+/g, " ").trim();
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ text, source: "kw_to_prompt", priority: 5 });
        if (out.length >= max) return out;
      }
    }
    // Direct autocomplete suggestions as prompts (real buyer phrasing).
    for (const kw of multi.unique.slice(0, 5)) {
      const text = kw.endsWith("?") ? kw : `${kw}?`;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, source: "autocomplete_prompt", priority: 8 });
      if (out.length >= max) return out;
    }
  }

  return out.sort((a, b) => b.priority - a.priority);
}
