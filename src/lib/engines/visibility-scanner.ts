import { queryLLMForVisibility } from "@/lib/providers/ai-gateway";
import { searchGoogleOrganic } from "@/lib/providers/dataforseo";
import { searchPerplexity, queryPerplexitySonar } from "@/lib/providers/perplexity";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";

export interface VisibilityScanConfig {
  projectId: string;
  runId: string;
  brandName: string;
  brandDomain: string;
  competitors: string[];
  location: string;
  prompts: Array<{ id?: string; text: string; priority?: number }>;
  engines?: VisibilityEngine[];
  maxPrompts?: number;
}

const DEFAULT_ENGINES: VisibilityEngine[] = [
  "chatgpt",
  "perplexity",
  "gemini",
  "claude",
  "google_organic",
  "google_ai_overview",
];

export async function runVisibilityScan(
  config: VisibilityScanConfig
): Promise<Omit<VisibilityResult, "id" | "created_at">[]> {
  const engines = config.engines || DEFAULT_ENGINES;
  const results: Omit<VisibilityResult, "id" | "created_at">[] = [];
  const scanLimit = config.maxPrompts ?? 30;

  const promptsToScan = config.prompts
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, scanLimit);

  for (const prompt of promptsToScan) {
    for (const engine of engines) {
      const result = await scanSinglePrompt(config, prompt, engine);
      if (result) results.push(result);
    }
  }

  return results;
}

async function scanSinglePrompt(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine
): Promise<Omit<VisibilityResult, "id" | "created_at"> | null> {
  const base = {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: false,
    brand_cited: false,
    competitor_mentions: {} as Record<string, boolean>,
    competitor_citations: {} as Record<string, boolean>,
    source_domains: [] as string[],
    cited_urls: [] as string[],
  };

  try {
    if (engine === "chatgpt") {
      const res = await queryLLMForVisibility("openai", prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return { ...base, ...mapAIResult(res.data) };
      }
    } else if (engine === "gemini") {
      const res = await queryLLMForVisibility("gemini", prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return { ...base, ...mapAIResult(res.data) };
      }
    } else if (engine === "claude") {
      const res = await queryLLMForVisibility("claude", prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return { ...base, ...mapAIResult(res.data) };
      }
    } else if (engine === "perplexity") {
      const res = await queryPerplexitySonar(prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return {
          ...base,
          brand_mentioned: res.data.brandMentioned,
          brand_cited: res.data.brandCited,
          competitor_mentions: res.data.competitorMentions,
          cited_urls: res.data.citations,
          source_domains: res.data.citations.map((u) => {
            try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
          }).filter(Boolean),
          raw_response: { answer: res.data.answer },
        };
      }
    } else if (engine === "google_organic" || engine === "google_ai_overview") {
      const res = await searchGoogleOrganic(prompt.text, config.location, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        const aiCited = res.data.aiOverview?.citedDomains.some((d) =>
          d.includes(config.brandDomain.replace(/^www\./, "").split(".")[0])
        ) || false;
        return {
          ...base,
          brand_mentioned: res.data.brandInResults,
          brand_cited: aiCited,
          competitor_mentions: res.data.competitorInResults,
          source_domains: res.data.aiOverview?.citedDomains || [],
          cited_urls: res.data.aiOverview?.citedUrls || [],
          raw_response: { organic: res.data.organicResults, aiOverview: res.data.aiOverview },
        };
      }
    }
  } catch {
    // Skip failed engine/prompt combo
  }

  return null;
}

function mapAIResult(data: {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  competitorCitations: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  rawResponse: string;
}) {
  return {
    brand_mentioned: data.brandMentioned,
    brand_cited: data.brandCited,
    competitor_mentions: data.competitorMentions,
    competitor_citations: data.competitorCitations,
    source_domains: data.sourceDomains,
    cited_urls: data.citedUrls,
    raw_response: { text: data.rawResponse },
  };
}

export function calculateVisibilityMetrics(results: VisibilityResult[]) {
  const total = results.length;
  if (total === 0) return { mentionRate: 0, citationRate: 0, shareOfVoice: 0, winRate: 0 };

  const mentions = results.filter((r) => r.brand_mentioned).length;
  const citations = results.filter((r) => r.brand_cited).length;

  const brandWins = results.filter((r) => {
    const compMentioned = Object.values(r.competitor_mentions).some(Boolean);
    return r.brand_mentioned && !compMentioned;
  }).length;

  const brandAndCompBoth = results.filter((r) => {
    const compMentioned = Object.values(r.competitor_mentions).some(Boolean);
    return r.brand_mentioned && compMentioned;
  }).length;

  const winRate = (brandWins + brandAndCompBoth) > 0
    ? brandWins / (brandWins + brandAndCompBoth + results.filter((r) => !r.brand_mentioned && Object.values(r.competitor_mentions).some(Boolean)).length)
    : 0;

  return {
    mentionRate: mentions / total,
    citationRate: citations / total,
    shareOfVoice: mentions / total,
    winRate,
  };
}
