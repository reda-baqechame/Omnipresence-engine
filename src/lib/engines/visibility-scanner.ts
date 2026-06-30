import { queryLLMForVisibility } from "@/lib/providers/ai-gateway";
import { hasOllamaCapability, getOllamaModel } from "@/lib/providers/ollama";
import {
  searchLLMMentions,
  type LLMPlatform,
} from "@/lib/providers/dataforseo";
import { hasLLMMentionsCapability } from "@/lib/config/capabilities";
import { queryPerplexitySonar } from "@/lib/providers/perplexity";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { hasAiUiCapture, captureAiUiSurface } from "@/lib/providers/ai-ui-capture";
import { logProviderError } from "@/lib/observability/log";
import { makeBrandMatcher, makeCompetitorMatcher, sameRegistrableDomain, type EntityMatcher } from "@/lib/engines/brand-matcher";
import type { VisibilityEngine, VisibilityResult } from "@/types/database";
import type { DataSource, DataQuality } from "@/types/database";
import { SCAN_ENGINES } from "@/lib/config/scan-engines";
import { hasLangfuse, mirrorTracesToLangfuse } from "@/lib/providers/langfuse";

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
  /**
   * Optional persona conditioning (Wave O3). When set, AI probes answer from
   * this persona's perspective and the persona+geo are recorded on the probe
   * trace. The stored prompt_text stays the original (clean) prompt.
   */
  persona?: string;
}

export interface VisibilityScanResult extends Omit<VisibilityResult, "id" | "created_at"> {
  data_source: DataQuality;
}

const DEFAULT_ENGINES: VisibilityEngine[] = SCAN_ENGINES;
// Samples per LLM prompt (majority-voted to tame AI response volatility).
// Clamped to 1-10 and NaN-safe so a bad env value can never silently disable
// LLM visibility (0 runs) or blow the budget with a runaway value.
const AI_SAMPLE_RUNS = Math.min(10, Math.max(1, Math.floor(Number(process.env.VISIBILITY_SAMPLE_RUNS) || 3)));

// Ground the first LLM sample with a live web-search tool (real cited URLs)
// unless explicitly disabled. The cost firewall: only ONE grounded call per
// prompt/engine; the rest sample parametrically for mention-rate stability.
const AI_GROUNDED_SEARCH_ON = process.env.AI_GROUNDED_SEARCH !== "false";

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

  // Overall wall-clock budget so a slow provider chain can't run the scan past
  // the host's function limit and get hard-killed (which would lose ALL results
  // and leave the run wedged). When the budget is exhausted we stop probing and
  // return what we measured so far — a partial-but-honest result beats a kill.
  const VISIBILITY_SCAN_BUDGET_MS = Math.max(
    60000,
    Number(process.env.VISIBILITY_SCAN_BUDGET_MS) || 240000
  );
  const deadline = Date.now() + VISIBILITY_SCAN_BUDGET_MS;

  let budgetExhausted = false;
  for (const prompt of promptsToScan) {
    if (budgetExhausted) break;
    for (const engine of engines) {
      if (Date.now() >= deadline) {
        budgetExhausted = true;
        logProviderError("visibility.scan_budget_exhausted", new Error("scan budget exhausted"), {
          measured: results.length,
          prompt: prompt.text.slice(0, 80),
        });
        break;
      }
      const result = await scanSinglePrompt(config, prompt, engine);
      if (result) {
        // Stamp persona/geo so the probe trace records the measurement cell
        // (Wave O3). Stored prompt_text stays the clean original prompt.
        if (config.persona || config.location) {
          result.raw_response = {
            ...(result.raw_response || {}),
            ...(config.persona ? { persona: config.persona } : {}),
            geo: config.location,
          };
        }
        results.push(result);
      }
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
    // Default to the honest "unavailable" rather than "simulated": every branch
    // below overrides this, but if a future code path forgets to, an unmeasured
    // probe must never silently read as fabricated data in a real scan.
    data_source: "unavailable" as DataQuality,
  };

  const domainLower = config.brandDomain.replace(/^www\./, "").toLowerCase();
  const brandToken = domainLower.split(".")[0];
  const brandMatcher = makeBrandMatcher(config.brandName, config.brandDomain);

  // Preferred (when enabled): grounded UI-surface capture for AI engines —
  // the real surface a user sees, not just the model's parametric knowledge.
  if (hasAiUiCapture() && (LLM_ENGINES.has(engine) || engine === "perplexity" || engine === "google_ai_overview" || engine === "bing_copilot")) {
    const surface = engine === "claude" ? "chatgpt" : (engine as "chatgpt" | "gemini" | "perplexity" | "google_ai_overview" | "bing_copilot");
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
        third_party_cited: captured.brandMentioned && [...new Set(sourceDomains)].some((d) => !sameRegistrableDomain(d, config.brandDomain)),
        answer_position: answerPosition(captured.answer, config.brandName, config.competitors),
        sample_count: 1,
        variance: 0,
        raw_response: {
          answer: captured.answer,
          data_source: "measured",
          data_source_detail: "ai_ui_capture",
          measurement_mode: "grounded",
          entity_prominence: computeEntityProminence(captured.answer, [config.brandName, ...config.competitors]),
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
          third_party_cited: res.data.brandMentioned && sourceDomains.some((d) => !sameRegistrableDomain(d, config.brandDomain)),
          answer_position: answerPosition(answer, config.brandName, config.competitors),
          sample_count: 1,
          variance: 0,
          raw_response: {
            answer,
            data_source: "measured",
            data_source_detail: "perplexity",
            measurement_mode: "grounded",
            entity_prominence: computeEntityProminence(answer, [config.brandName, ...config.competitors]),
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
        // Honesty gate: the AI Overview engine is only truly measured when the
        // provider actually returned an AI Overview. Serper(default)/Brave can't,
        // and falling back to plain organic while labeling it "grounded AI
        // Overview" is exactly the kind of mislabel an expert catches. Emit an
        // explicit unavailable row instead of a fake grounded one.
        if (engine === "google_ai_overview" && !res.data.aiOverview) {
          return unavailableRow(base, "ai_overview_unsupported_by_provider", res.provider);
        }

        const aiDomains = res.data.aiOverview?.citedDomains || [];
        const aiUrls = res.data.aiOverview?.citedUrls || [];
        const aiCited = brandMatcher.citedInDomains(aiDomains);

        const top = res.data.organicResults.slice(0, 10);
        // A SERP full of pages ABOUT the brand (G2, Trustpilot, Reddit "Why X?",
        // news) is real brand visibility even when the brand's own domain isn't
        // the URL. Count the brand name appearing in result titles as a mention,
        // not just owning a ranking domain — otherwise strong brands read as
        // "not mentioned" on review/comparison queries (a weak, misleading miss).
        const brandInTitles = top.some((r) => brandMatcher.mentionedIn(r.title || ""));
        const brandInAi = res.data.brandInResults || aiCited;
        const brandPresent = brandInAi || brandInTitles;

        const competitorMentions: Record<string, boolean> = { ...res.data.competitorInResults };
        for (const comp of config.competitors) {
          if (!competitorMentions[comp]) {
            const cm = makeCompetitorMatcher(comp);
            competitorMentions[comp] = top.some((r) => cm.mentionedIn(r.title || ""));
          }
        }

        const organicDomains = top
          .map((r) => tryHostname(r.url))
          .filter(Boolean);
        const organicUrls = top.map((r) => r.url).filter(Boolean);

        // Brand's organic rank = its position in the answer surface (eTLD+1).
        const organicPosition = res.data.organicResults.findIndex(
          (r) => sameRegistrableDomain(r.url, config.brandDomain)
        );

        return {
          ...base,
          brand_mentioned: brandPresent,
          brand_cited: aiCited,
          competitor_mentions: competitorMentions,
          source_domains: [...new Set([...aiDomains, ...organicDomains])],
          cited_urls: [...new Set([...aiUrls, ...organicUrls])],
          measurement_mode: "grounded",
          sentiment: brandPresent ? "neutral" : "unknown",
          recommendation_strength: aiCited ? 1 : brandPresent ? 0.5 : 0,
          owned_cited: aiCited || organicPosition >= 0,
          third_party_cited:
            brandPresent &&
            [...aiDomains, ...organicDomains].some((d) => !sameRegistrableDomain(d, config.brandDomain)),
          answer_position: organicPosition >= 0 ? organicPosition + 1 : undefined,
          sample_count: 1,
          variance: 0,
          raw_response: {
            organic: res.data.organicResults,
            aiOverview: res.data.aiOverview,
            data_source: "measured",
            data_source_detail: res.provider || "serp",
            measurement_mode: "grounded",
            // Prominence from the ranked answer surface: result titles in rank
            // order + the AI Overview text. Position in this blob mirrors SERP
            // rank, so an entity in the top result outweighs one ranked #9.
            entity_prominence: computeEntityProminence(
              [...top.map((r) => r.title || ""), res.data.aiOverview?.text || ""].join("\n"),
              [config.brandName, ...config.competitors]
            ),
          },
          data_source: "measured",
        };
      }
    } else if (engine === "bing_copilot") {
      // Microsoft Copilot has no public answer API and the Bing Web Search API
      // has been retired, so the ONLY compliant measurement is the UI-capture
      // backend handled above. If that produced nothing, we honestly label this
      // engine unavailable rather than proxy it with another model's answer.
      return unavailableRow(base, "copilot_requires_ui_capture_backend");
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

  // Nothing measured this engine. Emit an explicit `unavailable` row rather than
  // dropping it (null), so coverage gaps are honest: "we attempted X engine and
  // couldn't measure it" is different from "X engine says you're not mentioned".
  return unavailableRow(base, "no_provider_for_engine");
}

/**
 * An honest "we could not measure this" row. Counts toward coverage (lowers
 * measuredRate) but is excluded from mention/citation rates so a failed probe
 * never reads as "brand not mentioned".
 */
function unavailableRow(
  base: Omit<VisibilityScanResult, "data_source"> & { data_source: DataQuality },
  reason: string,
  provider?: string
): VisibilityScanResult {
  return {
    ...base,
    measurement_mode: "unavailable",
    sample_count: 0,
    variance: 0,
    raw_response: {
      data_source: "unavailable",
      reason,
      ...(provider ? { provider } : {}),
    },
    data_source: "unavailable",
  };
}

async function sampleLLMVisibility(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  _domainLower: string,
  _brandToken: string
): Promise<VisibilityScanResult | null> {
  const provider: "openai" | "gemini" | "claude" = engine === "chatgpt" ? "openai" : engine === "gemini" ? "gemini" : "claude";
  const runs: Array<ReturnType<typeof mapAIResult> & { text: string }> = [];

  // Cost-bounded grounding: the FIRST sample uses a live web-search tool (real
  // cited URLs → grounded measurement); the remaining samples are cheap
  // parametric reads that only stabilise the mention rate. So we pay for one
  // grounded call per prompt/engine, not N. Grounding is on unless disabled.
  const groundingOn = AI_GROUNDED_SEARCH_ON;
  for (let i = 0; i < AI_SAMPLE_RUNS; i++) {
    const res = await queryLLMForVisibility(
      provider,
      prompt.text,
      config.brandName,
      config.brandDomain,
      config.competitors,
      { grounded: groundingOn && i === 0, persona: config.persona }
    );
    if (res.success && res.data) {
      runs.push({ ...mapAIResult(res.data), text: res.data.rawResponse || "" });
    }
  }

  // Free graceful fallback: if no paid LLM key produced a sample, probe a
  // self-hosted open model (Ollama). Still model_knowledge (parametric).
  let usedOllama = false;
  if (runs.length === 0 && hasOllamaCapability()) {
    for (let i = 0; i < AI_SAMPLE_RUNS; i++) {
      const res = await queryLLMForVisibility(
        "ollama",
        prompt.text,
        config.brandName,
        config.brandDomain,
        config.competitors,
        { persona: config.persona }
      );
      if (res.success && res.data) {
        runs.push({ ...mapAIResult(res.data), text: res.data.rawResponse || "" });
        usedOllama = true;
      }
    }
  }

  if (runs.length === 0) return null;

  // Did any sample actually run grounded (real citations)? That decides whether
  // this probe is honestly "grounded/measured" vs "model_knowledge".
  const groundedRuns = runs.filter((r) => r.grounded);
  const isGrounded = groundedRuns.length > 0;

  const mentionRate = runs.filter((r) => r.brand_mentioned).length / runs.length;
  // Citation rate is meaningful ONLY from grounded runs (parametric runs never
  // cite). Computing it over all runs would dilute a real citation to 1/N.
  const citationBase = isGrounded ? groundedRuns : runs;
  const citationRate = citationBase.filter((r) => r.brand_cited).length / citationBase.length;
  const aggregated = runs[runs.length - 1];
  const combinedText = runs.map((r) => r.text).join("\n\n");

  const competitorMentions: Record<string, boolean> = {};
  for (const comp of config.competitors) {
    competitorMentions[comp] = runs.some((r) => r.competitor_mentions[comp]);
  }

  // Source domains/citations come only from grounded runs (real URLs).
  const sourceDomains = [...new Set(groundedRuns.flatMap((r) => r.source_domains))];
  // Average recommendation strength only over runs that actually mentioned the brand.
  const mentionedRuns = runs.filter((r) => r.brand_mentioned);
  const recStrength = mentionedRuns.length
    ? mentionedRuns.reduce((s, r) => s + recommendationStrength(r.text, config.brandName), 0) / mentionedRuns.length
    : 0;

  // Confidence from how consistent the samples were AND how many we ran. AI
  // answers are volatile, so a unanimous 3/3 reads as more trustworthy than a
  // split 2/3, and any single-sample read is shrunk so it never claims false
  // certainty. agreement is the majority-class share (0.5..1).
  const agreement = Math.max(mentionRate, 1 - mentionRate);
  const sampleConfidence = Math.round(agreement * (runs.length / (runs.length + 1)) * 100) / 100;

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
    cited_urls: [...new Set(groundedRuns.flatMap((r) => r.cited_urls))],
    // Grounded when at least one sample used a live web-search tool (real cited
    // URLs); otherwise the model's PARAMETRIC knowledge (no browsing).
    measurement_mode: isGrounded ? "grounded" : "model_knowledge",
    sentiment: mentionRate >= 0.5 ? analyzeSentiment(combinedText, config.brandName) : "unknown",
    recommendation_strength: recStrength,
    owned_cited: isGrounded && citationRate >= 0.5,
    third_party_cited: isGrounded && sourceDomains.some((d) => !sameRegistrableDomain(d, config.brandDomain)),
    answer_position: answerPosition(combinedText, config.brandName, config.competitors),
    confidence: sampleConfidence,
    sample_count: runs.length,
    variance: Math.round(mentionRate * (1 - mentionRate) * 1000) / 1000,
    raw_response: {
      sample_runs: runs.length,
      grounded_runs: groundedRuns.length,
      mention_rate: mentionRate,
      citation_rate: citationRate,
      data_source: isGrounded ? "measured" : "model_knowledge",
      data_source_detail: usedOllama
        ? `ollama:${getOllamaModel()}`
        : isGrounded
          ? "llm_grounded"
          : "llm_direct",
      measurement_mode: isGrounded ? "grounded" : "model_knowledge",
      entity_prominence: computeEntityProminence(combinedText, [config.brandName, ...config.competitors]),
      label: usedOllama
        ? `Model-knowledge (open model ${getOllamaModel()}, ${runs.length}-run sample, no browsing)`
        : isGrounded
          ? `Grounded web search (${groundedRuns.length} grounded + ${runs.length - groundedRuns.length} parametric sample${runs.length === 1 ? "" : "s"})`
          : `Model-knowledge (${runs.length}-run sample, no browsing)`,
    },
    data_source: isGrounded ? "measured" : "model_knowledge",
  };
}

async function scanViaLLMMentions(
  config: VisibilityScanConfig,
  prompt: { id?: string; text: string },
  engine: VisibilityEngine,
  platform: LLMPlatform,
  _domainLower: string,
  _brandToken: string
): Promise<VisibilityScanResult | null> {
  const res = await searchLLMMentions(prompt.text, platform, config.location);
  if (!res.success || !res.data?.length) return null;

  const allSources = res.data.flatMap((m) => m.sources);
  const citedUrls = allSources.map((s) => s.url || "").filter(Boolean);
  const sourceDomains = allSources
    .map((s) => s.domain || (s.url ? tryHostname(s.url) : ""))
    .filter(Boolean);

  const brandMatcher = makeBrandMatcher(config.brandName, config.brandDomain);
  const brandCited = brandMatcher.citedInDomains(sourceDomains) || brandMatcher.citedInUrls(citedUrls);

  const answerText = res.data.map((m) => m.answer || "").join(" ");
  const brandMentioned = brandCited || brandMatcher.mentionedIn(answerText);

  const competitorMentions: Record<string, boolean> = {};
  const competitorCitations: Record<string, boolean> = {};
  for (const comp of config.competitors) {
    const cm = makeCompetitorMatcher(comp);
    competitorMentions[comp] = cm.mentionedIn(answerText);
    competitorCitations[comp] = cm.citedInDomains(sourceDomains);
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
    third_party_cited: brandMentioned && [...new Set(sourceDomains)].some((d) => !sameRegistrableDomain(d, config.brandDomain)),
    answer_position: answerPosition(answerText, config.brandName, config.competitors),
    sample_count: res.data.length,
    variance: 0,
    raw_response: {
      llmMentions: res.data,
      data_source: "measured",
      data_source_detail: "dataforseo",
      measurement_mode: "grounded",
      aiSearchVolume: res.data[0]?.aiSearchVolume,
      entity_prominence: computeEntityProminence(answerText, [config.brandName, ...config.competitors]),
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

export interface EntityProminence {
  /** 1 = strongly recommended near the mention, 0.5 = mentioned in passing. */
  strength: number;
  /** Ordinal slot among all named entities by first appearance (1 = first). */
  position: number;
}

/**
 * Per-entity prominence for a single answer — the symmetric building block of a
 * prominence-weighted Share of Voice. Ranks brand + competitors by first
 * appearance and scores each one's recommendation strength, so a competitor
 * named as the "#1 pick" in sentence one outranks one buried at the bottom. We
 * compute this AT SCAN TIME (where the real answer text exists) and persist it
 * in the freeform raw_response JSON, so SoV can be reconstructed without a
 * schema change and without re-querying the model.
 */
export function computeEntityProminence(text: string, entities: string[]): Record<string, EntityProminence> {
  if (!text) return {};
  const lower = text.toLowerCase();
  const found = entities
    .filter((name) => name && name.trim())
    .map((name) => ({ name, idx: lower.indexOf(name.toLowerCase()) }))
    .filter((e) => e.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const out: Record<string, EntityProminence> = {};
  found.forEach((e, i) => {
    out[e.name] = { strength: recommendationStrength(text, e.name), position: i + 1 };
  });
  return out;
}

function mapAIResult(data: {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  competitorCitations: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  rawResponse: string;
  grounded?: boolean;
}) {
  return {
    brand_mentioned: data.brandMentioned,
    brand_cited: data.brandCited,
    competitor_mentions: data.competitorMentions,
    competitor_citations: data.competitorCitations,
    source_domains: data.sourceDomains,
    cited_urls: data.citedUrls,
    grounded: Boolean(data.grounded),
    raw_response: {
      text: data.rawResponse,
      data_source: data.grounded ? "measured" : "model_knowledge",
      data_source_detail: data.grounded ? "llm_grounded" : "llm_direct",
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

/**
 * Wilson score interval for a binomial proportion — the small-sample-robust 95%
 * CI that polling/analytics tools use (never returns <0 or >1, and stays sane at
 * n=1 unlike the naive normal approximation). z=1.96 ≈ 95% confidence.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)) / denom;
  return {
    low: Math.max(0, Math.round((center - margin) * 1000) / 1000),
    high: Math.min(1, Math.round((center + margin) * 1000) / 1000),
  };
}

/**
 * Safe truthy-check over the competitor_mentions JSON column. The column is
 * typed Record<string,boolean> but is freeform DB JSON, so legacy/partial rows
 * can hold null or the wrong container — a raw Object.values(null) would throw
 * and crash metric computation (which runs on the dashboard and in scoring).
 */
function anyCompetitorMentioned(cm: unknown): boolean {
  if (!cm || typeof cm !== "object" || Array.isArray(cm)) return false;
  return Object.values(cm as Record<string, unknown>).some(Boolean);
}

export function calculateVisibilityMetrics(results: Array<Pick<VisibilityResult, "brand_mentioned" | "brand_cited" | "competitor_mentions" | "raw_response" | "data_source" | "recommendation_strength" | "answer_position" | "confidence">>) {
  const attempted = results.length;
  const EMPTY = {
    mentionRate: 0,
    citationRate: 0,
    shareOfVoice: 0,
    winRate: 0,
    measuredRate: 0,
    prominence: 0,
    avgPosition: null as number | null,
    confidence: 0,
    mentionRateCI: { low: 0, high: 0 },
    sampleSize: 0,
  };
  if (attempted === 0) return EMPTY;

  const dq = (r: { data_source?: DataQuality; raw_response?: Record<string, unknown> }) =>
    r.data_source ?? (r.raw_response?.data_source as DataQuality | undefined);

  // Rates are computed over the COUNTABLE pool (measured + model_knowledge) so an
  // `unavailable` probe never reads as "brand not mentioned". measuredRate keeps
  // the full attempted denominator to expose coverage gaps honestly.
  const pool = results.filter((r) => {
    const ds = dq(r);
    return ds === "measured" || ds === "model_knowledge";
  });
  const total = pool.length;
  const measured = pool.length;
  if (total === 0) return EMPTY;

  const mentions = pool.filter((r) => r.brand_mentioned).length;
  const citations = pool.filter((r) => r.brand_cited).length;

  const brandWins = pool.filter((r) => {
    const compMentioned = anyCompetitorMentioned(r.competitor_mentions);
    return r.brand_mentioned && !compMentioned;
  }).length;

  const brandAndCompBoth = pool.filter((r) => {
    const compMentioned = anyCompetitorMentioned(r.competitor_mentions);
    return r.brand_mentioned && compMentioned;
  }).length;

  const compOnly = pool.filter((r) => {
    const compMentioned = anyCompetitorMentioned(r.competitor_mentions);
    return !r.brand_mentioned && compMentioned;
  }).length;

  const winRate = (brandWins + brandAndCompBoth + compOnly) > 0
    ? brandWins / (brandWins + brandAndCompBoth + compOnly)
    : 0;

  const totalMentions = mentions + compOnly + brandAndCompBoth;
  const shareOfVoice = totalMentions > 0 ? mentions / totalMentions : 0;

  // Prominence (Profound-class): how STRONGLY the brand is recommended when it
  // appears, not just whether it appears. recommendation_strength is 0-1 (1 =
  // top recommendation, lower = mentioned in passing). avgPosition is the mean
  // ordinal slot among answers that name the brand (lower = better). These
  // separate "named but buried" from "named as the #1 pick" — the signal raw
  // mention-count tools miss.
  const mentionedPool = pool.filter((r) => r.brand_mentioned);
  const prominence = mentionedPool.length
    ? mentionedPool.reduce((s, r) => s + (r.recommendation_strength ?? 0), 0) / mentionedPool.length
    : 0;
  const positions = mentionedPool
    .map((r) => r.answer_position)
    .filter((p): p is number => typeof p === "number" && p > 0);
  const avgPosition = positions.length
    ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
    : null;

  // Run-level 95% confidence interval on the mention rate (Wilson) so the
  // headline number carries a measured uncertainty band — wide when we could
  // only probe a few times, tight when the pool is large. This is the
  // statistical honesty analyst tools (Profound/Peec) charge for.
  const mentionRateCI = wilsonInterval(mentions, total);

  // Aggregate confidence: mean of per-probe confidence (sample agreement for
  // multi-run LLM reads), falling back to the data-quality prior when a probe
  // didn't carry its own confidence. 0-1, higher = more trustworthy run.
  const confidences = pool.map((r) =>
    typeof r.confidence === "number" ? r.confidence : probeConfidence(dq(r) ?? "simulated")
  );
  const confidence = confidences.length
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : 0;

  return {
    mentionRate: mentions / total,
    citationRate: citations / total,
    shareOfVoice,
    winRate,
    measuredRate: measured / attempted,
    prominence: Math.round(prominence * 100) / 100,
    avgPosition,
    confidence,
    mentionRateCI,
    sampleSize: total,
  };
}

export interface ProbeTraceRow {
  run_id?: string;
  project_id: string;
  prompt_id?: string;
  engine: string;
  prompt: string;
  persona: string | null;
  geo: string | null;
  response_excerpt: string | null;
  brand_mentioned: boolean;
  brand_cited: boolean;
  cited_sources: string[];
  competitors_mentioned: string[];
  model: string | null;
  grounding_mode: string | null;
  confidence: number;
  data_source: DataQuality;
  checked_at: string;
}

function probeConfidence(ds: DataQuality): number {
  if (ds === "measured") return 0.9;
  if (ds === "model_knowledge") return 0.6;
  if (ds === "estimated") return 0.4;
  return 0; // simulated / unavailable
}

function probeExcerpt(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const candidate = (raw.answer ?? raw.text ?? raw.label) as unknown;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 600);
  return null;
}

/**
 * Per-probe AEO observability rows. Each visibility result is one prompt×engine
 * probe; this flattens them into an auditable win/loss history (the proof +
 * "magic" layer). Demo/simulated probes are excluded — only real attempts.
 */
export function buildProbeTraceRows(results: VisibilityScanResult[]): ProbeTraceRow[] {
  const now = new Date().toISOString();
  const rows: ProbeTraceRow[] = [];
  for (const r of results) {
    if (r.data_source === "simulated") continue;
    const competitorsMentioned = Object.entries(r.competitor_mentions || {})
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
    const detail = (r.raw_response?.data_source_detail ?? r.raw_response?.provider) as
      | string
      | undefined;
    rows.push({
      run_id: r.run_id,
      project_id: r.project_id,
      prompt_id: r.prompt_id,
      engine: r.engine,
      prompt: r.prompt_text,
      persona: (r.raw_response?.persona as string) ?? null,
      geo: (r.raw_response?.geo as string) ?? null,
      response_excerpt: probeExcerpt(r.raw_response),
      brand_mentioned: Boolean(r.brand_mentioned),
      brand_cited: Boolean(r.brand_cited),
      cited_sources: [...new Set(r.source_domains || [])].slice(0, 25),
      competitors_mentioned: competitorsMentioned,
      model: detail ?? null,
      // Distinguish a real product-UI capture from other grounded paths so the
      // trace honestly records HOW the answer was grounded.
      grounding_mode: detail === "ai_ui_capture" ? "ui_capture" : (r.measurement_mode ?? null),
      confidence: probeConfidence(r.data_source),
      data_source: r.data_source,
      checked_at: now,
    });
  }
  return rows;
}

/** Persist probe traces (best-effort; never throws into the scan pipeline). */
export async function persistProbeTraces(
  supabase: {
    from: (t: string) => { insert: (rows: unknown[]) => PromiseLike<{ error: unknown }> };
  },
  results: VisibilityScanResult[]
): Promise<number> {
  const rows = buildProbeTraceRows(results);
  if (!rows.length) return 0;
  // Optional ops-grade mirror; Supabase stays the source of truth.
  if (hasLangfuse()) {
    void mirrorTracesToLangfuse(
      rows.map((r) => ({
        project_id: r.project_id,
        engine: r.engine,
        prompt: r.prompt,
        response_excerpt: r.response_excerpt,
        brand_mentioned: r.brand_mentioned,
        brand_cited: r.brand_cited,
        competitors_mentioned: r.competitors_mentioned,
        model: r.model,
        grounding_mode: r.grounding_mode,
        checked_at: r.checked_at,
      }))
    );
  }
  try {
    const { error } = await supabase.from("ai_probe_traces").insert(rows);
    if (error) {
      logProviderError("visibility.probeTraces", error);
      return 0;
    }
    return rows.length;
  } catch (error) {
    logProviderError("visibility.probeTraces", error);
    return 0;
  }
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

  const competitorMatchers = competitors.map((c) => ({ name: c, matcher: makeCompetitorMatcher(c) }));

  for (const r of results) {
    const volume = typeof r.raw_response?.aiSearchVolume === "number"
      ? r.raw_response.aiSearchVolume
      : undefined;

    const srcDomains = Array.isArray(r.source_domains) ? r.source_domains : [];
    const citedUrls = Array.isArray(r.cited_urls) ? r.cited_urls : [];
    for (let i = 0; i < srcDomains.length; i++) {
      const domain = srcDomains[i];
      const url = citedUrls[i];
      const citesBrand =
        r.brand_cited ||
        (brandDomain ? sameRegistrableDomain(domain, brandDomain) : false);
      let citesCompetitor = false;
      let competitorName: string | undefined;

      for (const { name, matcher } of competitorMatchers) {
        if (matcher.citedInDomains([domain])) {
          citesCompetitor = true;
          competitorName = name;
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
