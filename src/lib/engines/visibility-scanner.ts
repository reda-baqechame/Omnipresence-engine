import { queryLLMForVisibility } from "@/lib/providers/ai-gateway";
import {
  searchLLMMentions,
  type LLMPlatform,
} from "@/lib/providers/dataforseo";
import { hasLLMMentionsCapability } from "@/lib/config/capabilities";
import { queryPerplexitySonar } from "@/lib/providers/perplexity";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { hasAiUiCapture, captureAiUiSurface } from "@/lib/providers/ai-ui-capture";
import { logProviderError } from "@/lib/observability/log";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";
import type { DataSource, DataQuality } from "@/types/database";
import { SCAN_ENGINES } from "@/lib/config/scan-engines";

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
  data_source: DataQuality;
}

const DEFAULT_ENGINES: VisibilityEngine[] = SCAN_ENGINES;
const AI_SAMPLE_RUNS = Number(process.env.VISIBILITY_SAMPLE_RUNS || 3);

const LLM_ENGINES = new Set<VisibilityEngine>(["chatgpt", "claude", "gemini"]);

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
    data_source: "simulated" as DataQuality,
  };

  const domainLower = config.brandDomain.replace(/^www\./, "").toLowerCase();
  const brandToken = domainLower.split(".")[0];

  // Preferred (when enabled): grounded UI-surface capture for AI engines —
  // the real surface a user sees, not just the model's parametric knowledge.
  if (hasAiUiCapture() && (LLM_ENGINES.has(engine) || engine === "perplexity" || engine === "google_ai_overview")) {
    const surface = engine === "claude" ? "chatgpt" : (engine as "chatgpt" | "gemini" | "perplexity" | "google_ai_overview");
    const captured = await captureAiUiSurface(surface, prompt.text, config.brandName, config.brandDomain, config.competitors).catch(() => null);
    if (captured) {
      const sourceDomains = captured.sourceDomains.length
        ? captured.sourceDomains
        : captured.citedUrls.map(tryHostname).filter(Boolean);
      return {
        ...base,
        brand_mentioned: captured.brandMentioned,
        brand_cited: captured.brandCited,
        competitor_mentions: captured.competitorMentions,
        source_domains: [...new Set(sourceDomains)],
        cited_urls: captured.citedUrls,
        measurement_mode: "grounded",
        sentiment: captured.brandMentioned ? analyzeSentiment(captured.answer, config.brandName) : "unknown",
        recommendation_strength: captured.brandMentioned ? recommendationStrength(captured.answer, config.brandName) : 0,
        owned_cited: captured.brandCited,
        third_party_cited: captured.brandMentioned && [...new Set(sourceDomains)].some((d) => !d.includes(brandToken)),
        answer_position: answerPosition(captured.answer, config.brandName, config.competitors),
        sample_count: 1,
        variance: 0,
        raw_response: {
          answer: captured.answer,
          data_source: "measured",
          data_source_detail: "ai_ui_capture",
          measurement_mode: "grounded",
        },
        data_source: "measured",
      };
    }
  }

  // Primary: direct LLM queries and cheap SERP providers
  try {
    if (LLM_ENGINES.has(engine)) {
      const sampled = await sampleLLMVisibility(config, prompt, engine, domainLower, brandToken);
      if (sampled) return sampled;
    } else if (engine === "perplexity") {
      const res = await queryPerplexitySonar(prompt.text, config.brandName, config.brandDomain, config.competitors);
      if (res.success && res.data) {
        const sourceDomains = res.data.citations.map((u) => {
          try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
        }).filter(Boolean);
        const answer = res.data.answer || "";
        return {
          ...base,
          brand_mentioned: res.data.brandMentioned,
          brand_cited: res.data.brandCited,
          competitor_mentions: res.data.competitorMentions,
          cited_urls: res.data.citations,
          source_domains: sourceDomains,
          measurement_mode: "grounded",
          sentiment: res.data.brandMentioned ? analyzeSentiment(answer, config.brandName) : "unknown",
          recommendation_strength: res.data.brandMentioned ? recommendationStrength(answer, config.brandName) : 0,
          owned_cited: res.data.brandCited,
          third_party_cited: res.data.brandMentioned && sourceDomains.some((d) => !d.includes(brandToken)),
          answer_position: answerPosition(answer, config.brandName, config.competitors),
          sample_count: 1,
          variance: 0,
          raw_response: {
            answer,
            data_source: "measured",
            data_source_detail: "perplexity",
            measurement_mode: "grounded",
          },
          data_source: "measured",
        };
      }
    } else if (engine === "google_organic" || engine === "google_ai_overview") {
      const res = await searchGoogleOrganicRouter(
        prompt.text,
        config.location,
        config.brandDomain,
        config.competitors
      );

      if (res.success && res.data) {
        const aiCited = res.data.aiOverview?.citedDomains.some((d) =>
          d.includes(brandToken) || d.includes(domainLower)
        ) || false;
        const brandInAi = res.data.brandInResults || aiCited;

        const organicDomains = res.data.organicResults
          .slice(0, 10)
          .map((r) => tryHostname(r.url))
          .filter(Boolean);
        const organicUrls = res.data.organicResults.slice(0, 10).map((r) => r.url).filter(Boolean);
        const aiDomains = res.data.aiOverview?.citedDomains || [];
        const aiUrls = res.data.aiOverview?.citedUrls || [];

        // Brand's organic rank = its position in the answer surface.
        const organicPosition = res.data.organicResults.findIndex(
          (r) => tryHostname(r.url).includes(domainLower) || tryHostname(r.url).includes(brandToken)
        );

        return {
          ...base,
          brand_mentioned: brandInAi,
          brand_cited: aiCited,
          competitor_mentions: res.data.competitorInResults,
          source_domains: [...new Set([...aiDomains, ...organicDomains])],
          cited_urls: [...new Set([...aiUrls, ...organicUrls])],
          measurement_mode: "grounded",
          sentiment: brandInAi ? "neutral" : "unknown",
          recommendation_strength: aiCited ? 1 : brandInAi ? 0.5 : 0,
          owned_cited: aiCited || organicPosition >= 0,
          third_party_cited: brandInAi && aiDomains.some((d) => !d.includes(brandToken)),
          answer_position: organicPosition >= 0 ? organicPosition + 1 : undefined,
          sample_count: 1,
          variance: 0,
          raw_response: {
            organic: res.data.organicResults,
            aiOverview: res.data.aiOverview,
            data_source: "measured",
            data_source_detail: res.provider || "serp",
            measurement_mode: "grounded",
          },
          data_source: "measured",
        };
      }
    }
  } catch (error) {
    // Grounded provider failed — log it (never silently render as "not mentioned"),
    // then fall through to the LLM-mentions fallback / null below.
    logProviderError("visibility.grounded", error, { engine, prompt: prompt.text.slice(0, 120) });
  }

  // Optional fallback: DataForSEO LLM Mentions (when keys exist)
  const llmPlatform = LLM_PLATFORM_MAP[engine];
  if (llmPlatform && hasLLMMentionsCapability()) {
    const measured = await scanViaLLMMentions(config, prompt, engine, llmPlatform, domainLower, brandToken);
    if (measured) return measured;
  }

  return null;
}

async function sampleLLMVisibility(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  _domainLower: string,
  _brandToken: string
): Promise<VisibilityScanResult | null> {
  const provider = engine === "chatgpt" ? "openai" : engine === "gemini" ? "gemini" : "claude";
  const runs: Array<ReturnType<typeof mapAIResult> & { text: string }> = [];

  for (let i = 0; i < AI_SAMPLE_RUNS; i++) {
    const res = await queryLLMForVisibility(
      provider,
      prompt.text,
      config.brandName,
      config.brandDomain,
      config.competitors
    );
    if (res.success && res.data) {
      runs.push({ ...mapAIResult(res.data), text: res.data.rawResponse || "" });
    }
  }

  if (runs.length === 0) return null;

  const mentionRate = runs.filter((r) => r.brand_mentioned).length / runs.length;
  const citationRate = runs.filter((r) => r.brand_cited).length / runs.length;
  const aggregated = runs[runs.length - 1];
  const combinedText = runs.map((r) => r.text).join("\n\n");

  const competitorMentions: Record<string, boolean> = {};
  for (const comp of config.competitors) {
    competitorMentions[comp] = runs.some((r) => r.competitor_mentions[comp]);
  }

  const sourceDomains = [...new Set(runs.flatMap((r) => r.source_domains))];
  // Average recommendation strength only over runs that actually mentioned the brand.
  const mentionedRuns = runs.filter((r) => r.brand_mentioned);
  const recStrength = mentionedRuns.length
    ? mentionedRuns.reduce((s, r) => s + recommendationStrength(r.text, config.brandName), 0) / mentionedRuns.length
    : 0;

  return {
    run_id: config.runId,
    project_id: config.projectId,
    prompt_id: prompt.id,
    engine,
    prompt_text: prompt.text,
    brand_mentioned: mentionRate >= 0.5,
    brand_cited: citationRate >= 0.5,
    competitor_mentions: competitorMentions,
    competitor_citations: aggregated.competitor_citations,
    source_domains: sourceDomains,
    cited_urls: [...new Set(runs.flatMap((r) => r.cited_urls))],
    // LLM-direct measures the model's PARAMETRIC knowledge, not a live search UI.
    measurement_mode: "model_knowledge",
    sentiment: mentionRate >= 0.5 ? analyzeSentiment(combinedText, config.brandName) : "unknown",
    recommendation_strength: recStrength,
    owned_cited: citationRate >= 0.5,
    third_party_cited: mentionRate >= 0.5 && sourceDomains.some((d) => !d.includes(_brandToken)),
    answer_position: answerPosition(combinedText, config.brandName, config.competitors),
    sample_count: runs.length,
    variance: Math.round(mentionRate * (1 - mentionRate) * 1000) / 1000,
    raw_response: {
      sample_runs: runs.length,
      mention_rate: mentionRate,
      citation_rate: citationRate,
      data_source: "model_knowledge",
      data_source_detail: "llm_direct",
      measurement_mode: "model_knowledge",
      label: `Model-knowledge (${runs.length}-run sample, no browsing)`,
    },
    data_source: "model_knowledge",
  };
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
    measurement_mode: "grounded",
    sentiment: brandMentioned ? analyzeSentiment(answerText, config.brandName) : "unknown",
    recommendation_strength: brandMentioned ? recommendationStrength(answerText, config.brandName) : 0,
    owned_cited: brandCited,
    third_party_cited: brandMentioned && [...new Set(sourceDomains)].some((d) => !d.includes(brandToken)),
    answer_position: answerPosition(answerText, config.brandName, config.competitors),
    sample_count: res.data.length,
    variance: 0,
    raw_response: {
      llmMentions: res.data,
      data_source: "measured",
      data_source_detail: "dataforseo",
      measurement_mode: "grounded",
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

const POSITIVE_TERMS = [
  "best", "top", "leading", "excellent", "great", "recommended", "recommend",
  "reliable", "trusted", "popular", "powerful", "favorite", "favourite", "strong",
  "high-quality", "award", "innovative", "preferred",
];
const NEGATIVE_TERMS = [
  "worst", "avoid", "poor", "unreliable", "scam", "disappointing", "lacking",
  "weak", "outdated", "overpriced", "complaint", "complaints", "issues", "buggy",
];

/** Heuristic sentiment in a window around the brand mention. */
function analyzeSentiment(
  text: string,
  brand: string
): "positive" | "neutral" | "negative" | "unknown" {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(brand.toLowerCase());
  if (idx < 0) return "unknown";
  const window = lower.slice(Math.max(0, idx - 140), idx + 140);
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_TERMS) if (window.includes(w)) pos++;
  for (const w of NEGATIVE_TERMS) if (window.includes(w)) neg++;
  if (pos > neg) return "positive";
  if (neg > pos) return "negative";
  return "neutral";
}

/** 0-1: strongly recommended (1), merely mentioned (0.5), or absent (0). */
function recommendationStrength(text: string, brand: string): number {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(brand.toLowerCase());
  if (idx < 0) return 0;
  const window = lower.slice(Math.max(0, idx - 90), idx + 90);
  const strong = ["best", "#1", "number one", "top", "recommend", "leading", "first choice", "go-to", "the go to"];
  return strong.some((s) => window.includes(s)) ? 1 : 0.5;
}

/** Ordinal position of the brand among brand+competitors by first appearance. */
function answerPosition(text: string, brand: string, competitors: string[]): number | undefined {
  const lower = text.toLowerCase();
  const entries = [
    { name: brand, idx: lower.indexOf(brand.toLowerCase()) },
    ...competitors.map((c) => ({ name: c, idx: lower.indexOf(c.toLowerCase()) })),
  ]
    .filter((e) => e.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const pos = entries.findIndex((e) => e.name === brand);
  return pos >= 0 ? pos + 1 : undefined;
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
    raw_response: {
      text: data.rawResponse,
      data_source: "measured",
      data_source_detail: "llm_direct",
    },
  };
}

export function getResultDataSourceLabel(result: Pick<VisibilityResult, "raw_response">): string {
  const detail = result.raw_response?.data_source_detail;
  if (typeof detail === "string") {
    const labels: Record<string, string> = {
      llm_direct: "Live LLM",
      perplexity: "Perplexity",
      serper: "Serper SERP",
      brave: "Brave SERP",
      dataforseo: "DataForSEO",
      omnidata: "OmniData",
    };
    return labels[detail] || detail;
  }
  const ds = result.raw_response?.data_source;
  if (ds === "measured") return "Live (grounded)";
  if (ds === "model_knowledge") return "Model-knowledge";
  return "Simulated";
}

export function calculateVisibilityMetrics(results: Array<Pick<VisibilityResult, "brand_mentioned" | "brand_cited" | "competitor_mentions" | "raw_response">>) {
  const total = results.length;
  if (total === 0) return { mentionRate: 0, citationRate: 0, shareOfVoice: 0, winRate: 0, measuredRate: 0 };

  const mentions = results.filter((r) => r.brand_mentioned).length;
  const citations = results.filter((r) => r.brand_cited).length;
  const measured = results.filter((r) => {
    const row = r as VisibilityScanResult;
    const ds = row.data_source ?? r.raw_response?.data_source;
    return ds === "measured" || ds === "model_knowledge";
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
  competitors: string[],
  brandDomain?: string
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

    const brandToken = brandDomain
      ? brandDomain.replace(/^www\./, "").toLowerCase().split(".")[0]
      : "";

    for (let i = 0; i < r.source_domains.length; i++) {
      const domain = r.source_domains[i];
      const url = r.cited_urls[i];
      const domainLower = domain.toLowerCase();
      const citesBrand =
        r.brand_cited ||
        (brandToken.length > 0 && domainLower.includes(brandToken)) ||
        (brandDomain ? domainLower.includes(brandDomain.replace(/^www\./, "").toLowerCase()) : false);
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
        // citation_sources uses the narrow legacy DataSource; model_knowledge
        // answers are still a real measurement of citation behavior.
        data_source: r.data_source === "simulated" ? "simulated" : "measured",
      });
    }
  }

  return rows;
}
