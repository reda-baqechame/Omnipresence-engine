import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * Multi-source autocomplete harvester (Phase 11) — fully keyless.
 * Pulls live suggestions from Google, YouTube, Bing, Amazon, and Google Play
 * suggest endpoints. Each source degrades independently (returns []).
 */

export type SuggestSource = "google" | "youtube" | "bing" | "amazon" | "play";

async function googleLike(q: string, ds?: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en${ds ? `&ds=${ds}` : ""}&q=${encodeURIComponent(q)}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
  if (!res.ok) return [];
  const data = (await res.json()) as [string, string[]];
  return Array.isArray(data?.[1]) ? data[1] : [];
}

async function bingSuggest(q: string): Promise<string[]> {
  const res = await fetchWithTimeout(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`, { timeoutMs: 8000 });
  if (!res.ok) return [];
  const data = (await res.json()) as [string, string[]];
  return Array.isArray(data?.[1]) ? data[1] : [];
}

async function amazonSuggest(q: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `https://completion.amazon.com/api/2017/suggestions?limit=11&prefix=${encodeURIComponent(q)}&alias=aps&site-variant=desktop`,
    { timeoutMs: 8000 }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { suggestions?: Array<{ value?: string }> };
  return (data.suggestions || []).map((s) => s.value || "").filter(Boolean);
}

async function playSuggest(q: string): Promise<string[]> {
  const res = await fetchWithTimeout(
    `https://market.android.com/suggest/SuggRequest?json=1&query=${encodeURIComponent(q)}&hl=en&gl=US`,
    { timeoutMs: 8000 }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ s?: string }>;
  return (Array.isArray(data) ? data : []).map((d) => d.s || "").filter(Boolean);
}

export async function getSuggestions(seed: string, source: SuggestSource): Promise<string[]> {
  try {
    switch (source) {
      case "google":
        return await googleLike(seed);
      case "youtube":
        return await googleLike(seed, "yt");
      case "bing":
        return await bingSuggest(seed);
      case "amazon":
        return await amazonSuggest(seed);
      case "play":
        return await playSuggest(seed);
      default:
        return [];
    }
  } catch (error) {
    logProviderError(`autocomplete:${source}`, error, { seed });
    return [];
  }
}

export interface MultiSuggestResult {
  available: boolean;
  bySource: Record<SuggestSource, string[]>;
  unique: string[];
}

/** Harvest suggestions from all sources for a seed. */
export async function getMultiSourceSuggestions(
  seed: string,
  sources: SuggestSource[] = ["google", "youtube", "bing", "amazon", "play"]
): Promise<MultiSuggestResult> {
  const results = await Promise.all(sources.map((s) => getSuggestions(seed, s).then((list) => [s, list] as const)));
  const bySource = {} as Record<SuggestSource, string[]>;
  const all = new Set<string>();
  for (const [src, list] of results) {
    bySource[src] = list;
    for (const k of list) all.add(k.toLowerCase().trim());
  }
  return {
    available: all.size > 0,
    bySource,
    unique: [...all],
  };
}
