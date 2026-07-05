/**
 * Prompt demand signals — Profound-style relative query interest per tracked prompt.
 * Uses keyless Google Autocomplete fan-out depth + Google Trends momentum.
 */
import { getMultiSourceSuggestions } from "@/lib/providers/autocomplete-multi";
import { getTrendsComparison } from "@/lib/providers/google-trends";

export interface PromptDemandSignal {
  prompt: string;
  /** 0-100 relative demand index (not absolute search volume). */
  demandIndex: number;
  /** Autocomplete suggestion count across sources (proxy for query breadth). */
  suggestionBreadth: number;
  /** Trends momentum vs baseline (-100 to +100). */
  trendMomentum: number;
  confidence: "high" | "medium" | "low";
  method: "autocomplete_trends" | "autocomplete_only" | "unavailable";
}

const MODIFIERS = ["best", "top", "how to", "vs", "review", "alternative"];

export async function measurePromptDemand(prompt: string, geo = "US"): Promise<PromptDemandSignal> {
  const base = prompt.trim().toLowerCase();
  if (!base) {
    return { prompt, demandIndex: 0, suggestionBreadth: 0, trendMomentum: 0, confidence: "low", method: "unavailable" };
  }

  const seeds = [base, ...MODIFIERS.map((m) => `${m} ${base}`).slice(0, 3)];
  let totalSuggestions = 0;
  for (const seed of seeds) {
    const multi = await getMultiSourceSuggestions(seed, ["google", "youtube", "bing"]);
    totalSuggestions += multi.unique.length;
  }

  const trends = await getTrendsComparison([base], geo);
  const trendScore = trends?.get(base) ?? 0;

  const breadthScore = Math.min(100, Math.round(totalSuggestions * 2.5));
  const demandIndex = Math.round(breadthScore * 0.6 + trendScore * 0.4);
  const trendMomentum = trendScore > 50 ? Math.round((trendScore - 50) * 2) : Math.round(trendScore - 50);

  return {
    prompt,
    demandIndex,
    suggestionBreadth: totalSuggestions,
    trendMomentum,
    confidence: totalSuggestions >= 8 ? "high" : totalSuggestions >= 3 ? "medium" : "low",
    method: trendScore > 0 ? "autocomplete_trends" : "autocomplete_only",
  };
}

export async function measurePromptDemandBatch(
  prompts: string[],
  opts: { max?: number; geo?: string } = {}
): Promise<PromptDemandSignal[]> {
  const list = [...new Set(prompts.map((p) => p.trim()).filter(Boolean))].slice(0, opts.max ?? 20);
  const out: PromptDemandSignal[] = [];
  for (const p of list) {
    out.push(await measurePromptDemand(p, opts.geo));
  }
  return out.sort((a, b) => b.demandIndex - a.demandIndex);
}
