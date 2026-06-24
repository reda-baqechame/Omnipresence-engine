import { queryLLMForVisibility } from "@/lib/providers/ai-gateway";
import {
  searchGoogleOrganic,
  searchLLMMentions,
  type LLMPlatform,
} from "@/lib/providers/dataforseo";
import { hasLLMMentionsCapability } from "@/lib/config/capabilities";
import { queryPerplexitySonar } from "@/lib/providers/perplexity";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";
import type { DataSource } from "@/types/database";

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

export interface VisibilityScanResult extends Omit<VisibilityResult, "id" | "created_at"> {
  data_source: DataSource;
}

const DEFAULT_ENGINES: VisibilityEngine[] = [
  "chatgpt",
  "perplexity",
  "gemini",
  "claude",
  "google_organic",
  "google_ai_overview",
];

const LLM_PLATFORM_MAP: Partial<Record<VisibilityEngine, LLMPlatform>> = {
  chatgpt: "chat_gpt",
  google_ai_overview: "google",
};

export async function runVisibilityScan(
  config: VisibilityScanConfig
): Promise<VisibilityScanResult[]> {
  const engines = config.engines || DEFAULT_ENGINES;
  const results: VisibilityScanResult[] = [];
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
): Promise<VisibilityScanResult | null> {
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
    data_source: "simulated" as DataSource,
  };

  const domainLower = config.brandDomain.replace(/^www\./, "").toLowerCase();
  const brandToken = domainLower.split(".")[0];

  // Primary: measured LLM Mentions data (DataForSEO)
  const llmPlatform = LLM_PLATFORM_MAP[engine];
  if (llmPlatform && hasLLMMentionsCapability()) {
    const measured = await scanViaLLMMentions(config, prompt, engine, llmPlatform, domainLower, brandToken);
    if (measured) return measured;
  }

  // Supplement: live engine queries
  try {
    if (engine === "chatgpt") {
      const res = await queryLLMForVisibility("openai", prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return { ...base, ...mapAIResult(res.data), data_source: "simulated" };
      }
    } else if (engine === "gemini") {
      const res = await queryLLMForVisibility("gemini", prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return { ...base, ...mapAIResult(res.data), data_source: "simulated" };
      }
    } else if (engine === "claude") {
      const res = await queryLLMForVisibility("claude", prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        return { ...base, ...mapAIResult(res.data), data_source: "simulated" };
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
          data_source: "simulated",
        };
      }
    } else if (engine === "google_organic" || engine === "google_ai_overview") {
      const res = await searchGoogleOrganic(prompt.text, config.location, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        const aiCited = res.data.aiOverview?.citedDomains.some((d) =>
          d.includes(brandToken)
        ) || false;
        const brandInAi = res.data.brandInResults || aiCited;
        return {
          ...base,
          brand_mentioned: brandInAi,
          brand_cited: aiCited,
          competitor_mentions: res.data.competitorInResults,
          source_domains: res.data.aiOverview?.citedDomains || [],
          cited_urls: res.data.aiOverview?.citedUrls || [],
          raw_response: { organic: res.data.organicResults, aiOverview: res.data.aiOverview },
          data_source: res.data.aiOverview ? "measured" : "simulated",
        };
      }
    }
  } catch {
    // Skip failed engine/prompt combo
  }

  return null;
}

async function scanViaLLMMentions(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  platform: LLMPlatform,
  domainLower: string,
  brandToken: string
): Promise<VisibilityScanResult | null> {
  const res = await searchLLMMentions(prompt.text, platform, config.location);
  if (!res.success || !res.data?.length) return null;

  const allSources = res.data.flatMap((m) => m.sources);
  const citedUrls = allSources.map((s) => s.url || "").filter(Boolean);
  const sourceDomains = allSources
    .map((s) => s.domain || (s.url ? tryHostname(s.url) : ""))
    .filter(Boolean);

  const brandCited = sourceDomains.some(
    (d) => d.includes(domainLower) || d.includes(brandToken)
  ) || citedUrls.some((u) => u.toLowerCase().includes(domainLower));

  const answerText = res.data.map((m) => m.answer || "").join(" ").toLowerCase();
  const brandMentioned =
    brandCited ||
    answerText.includes(config.brandName.toLowerCase()) ||
    answerText.includes(brandToken);

  const competitorMentions: Record<string, boolean> = {};
  const competitorCitations: Record<string, boolean> = {};
  for (const comp of config.competitors) {
    const compLower = comp.toLowerCase();
    competitorMentions[comp] = answerText.includes(compLower);
    competitorCitations[comp] = sourceDomains.some((d) => d.includes(compLower.replace(/\s+/g, "")));
  }

  return {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: brandMentioned,
    brand_cited: brandCited,
    competitor_mentions: competitorMentions,
    competitor_citations: competitorCitations,
    source_domains: [...new Set(sourceDomains)],
    cited_urls: citedUrls,
    raw_response: {
      llmMentions: res.data,
      data_source: "measured",
      aiSearchVolume: res.data[0]?.aiSearchVolume,
    },
    data_source: "measured",
  };
}

function tryHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
    raw_response: { text: data.rawResponse, data_source: "simulated" },
  };
}

export function calculateVisibilityMetrics(results: Array<Pick<VisibilityResult, "brand_mentioned" | "brand_cited" | "competitor_mentions" | "raw_response">>) {
  const total = results.length;
  if (total === 0) return { mentionRate: 0, citationRate: 0, shareOfVoice: 0, winRate: 0, measuredRate: 0 };

  const mentions = results.filter((r) => r.brand_mentioned).length;
  const citations = results.filter((r) => r.brand_cited).length;
  const measured = results.filter((r) => {
    const ds = r.raw_response?.data_source;
    return ds === "measured";
  }).length;

  const brandWins = results.filter((r) => {
    const compMentioned = Object.values(r.competitor_mentions).some(Boolean);
    return r.brand_mentioned && !compMentioned;
  }).length;

  const brandAndCompBoth = results.filter((r) => {
    const compMentioned = Object.values(r.competitor_mentions).some(Boolean);
    return r.brand_mentioned && compMentioned;
  }).length;

  const compOnly = results.filter((r) => {
    const compMentioned = Object.values(r.competitor_mentions).some(Boolean);
    return !r.brand_mentioned && compMentioned;
  }).length;

  const winRate = (brandWins + brandAndCompBoth + compOnly) > 0
    ? brandWins / (brandWins + brandAndCompBoth + compOnly)
    : 0;

  const totalMentions = mentions + compOnly + brandAndCompBoth;
  const shareOfVoice = totalMentions > 0 ? mentions / totalMentions : 0;

  return {
    mentionRate: mentions / total,
    citationRate: citations / total,
    shareOfVoice,
    winRate,
    measuredRate: measured / total,
  };
}

/** Extract citation source rows for DB persistence */
export function extractCitationSources(
  results: VisibilityScanResult[],
  competitors: string[]
): Array<{
  prompt_text: string;
  platform: string;
  source_domain: string;
  source_url?: string;
  cites_brand: boolean;
  cites_competitor: boolean;
  competitor_name?: string;
  ai_search_volume?: number;
  data_source: DataSource;
}> {
  const rows: Array<{
    prompt_text: string;
    platform: string;
    source_domain: string;
    source_url?: string;
    cites_brand: boolean;
    cites_competitor: boolean;
    competitor_name?: string;
    ai_search_volume?: number;
    data_source: DataSource;
  }> = [];

  for (const r of results) {
    const volume = typeof r.raw_response?.aiSearchVolume === "number"
      ? r.raw_response.aiSearchVolume
      : undefined;

    for (let i = 0; i < r.source_domains.length; i++) {
      const domain = r.source_domains[i];
      const url = r.cited_urls[i];
      const citesBrand = r.brand_cited;
      let citesCompetitor = false;
      let competitorName: string | undefined;

      for (const comp of competitors) {
        if (domain.includes(comp.toLowerCase().replace(/\s+/g, ""))) {
          citesCompetitor = true;
          competitorName = comp;
        }
      }

      rows.push({
        prompt_text: r.prompt_text,
        platform: r.engine,
        source_domain: domain,
        source_url: url,
        cites_brand: citesBrand,
        cites_competitor: citesCompetitor,
        competitor_name: competitorName,
        ai_search_volume: volume,
        data_source: r.data_source,
      });
    }
  }

  return rows;
}
