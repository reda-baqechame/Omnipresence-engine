import type { AIVisibilityResult, ProviderResult } from "./types";
import {
  assertWithinBudget,
  recordSpend,
  maxOutputTokens,
  type GuardProvider,
} from "./cost-guard";

const AI_BOTS = [
  "OAI-SearchBot",
  "GPTBot",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "anthropic-ai",
  "ClaudeBot",
  "Bytespider",
  "CCBot",
];

export { AI_BOTS };

/**
 * Default (cheap, effective) model id per provider, overridable via env so an
 * operator can swap in their preferred low-cost model without a code change.
 * Defaults are deliberately the cheapest capable models for this workload
 * (probes + structured extraction). Per-provider because a model id is not
 * portable across SDKs (you can't run a GPT id on Anthropic).
 */
export function defaultModelId(provider: "openai" | "gemini" | "anthropic"): string {
  const env = (k: string, dflt: string) => {
    const v = process.env[k];
    return v && v.trim() ? v.trim() : dflt;
  };
  if (provider === "openai") return env("AI_OPENAI_MODEL", "gpt-4o-mini");
  if (provider === "gemini") return env("AI_GEMINI_MODEL", "gemini-2.5-flash");
  return env("AI_ANTHROPIC_MODEL", "claude-haiku-4-5");
}

export interface VisibilityQueryOptions {
  /**
   * Use a live web-search tool so the answer carries REAL cited URLs (grounded
   * measurement). Costs more per call, so callers typically ground ONE sample and
   * sample the rest parametrically. Defaults to on for paid providers unless
   * AI_GROUNDED_SEARCH="false"; never applies to the local Ollama path.
   */
  grounded?: boolean;
  /** Persona conditioning (Wave O3): answer from this persona's perspective. */
  persona?: string;
}

function buildSystemPrompt(persona?: string): string {
  const base = `You are a search assistant. Answer the user's question naturally, citing sources when possible. Be factual and helpful.`;
  if (persona && persona.trim()) {
    return `${base} Answer from the perspective of a ${persona.trim()} evaluating options to buy or use.`;
  }
  return base;
}

function groundingDefaultOn(): boolean {
  return process.env.AI_GROUNDED_SEARCH !== "false";
}

// --- Grounded-probe response cache (cost firewall) --------------------------
// Web-search probes are the most expensive calls we make. Cache the grounded
// answer + sources by (provider, prompt) for a window so repeated probes of the
// same prompt the same day (panel re-runs, multi-engine fan-out) don't re-bill.
const GROUNDED_CACHE_TTL_MS = Math.max(0, Number(process.env.AI_PROBE_CACHE_TTL_MS) || 6 * 60 * 60 * 1000);
const groundedCache = new Map<string, { at: number; text: string; sources: string[] }>();

function groundedCacheKey(provider: string, prompt: string): string {
  return `${provider}::${prompt.trim().toLowerCase().slice(0, 400)}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Live web-search generation for one provider. Returns the answer text + the
 * REAL cited source URLs (from result.sources), or null when grounding is
 * unavailable/failed (caller falls back to the parametric path). Budget-guarded
 * and cached. Uses the AI SDK v6 provider web-search tools.
 */
async function runGroundedSearch(
  provider: "openai" | "gemini" | "claude",
  systemPrompt: string,
  prompt: string
): Promise<{ text: string; sources: string[] } | null> {
  const cacheKey = groundedCacheKey(provider, prompt);
  const cached = groundedCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GROUNDED_CACHE_TTL_MS) {
    return { text: cached.text, sources: cached.sources };
  }

  const guardProvider: GuardProvider =
    provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic";
  await assertWithinBudget(guardProvider);

  const { generateText } = await import("ai");
  let modelId: string;
  let model: Parameters<typeof generateText>[0]["model"];
  let tools: Record<string, unknown>;
  if (provider === "openai") {
    const { openai } = await import("@ai-sdk/openai");
    modelId = defaultModelId("openai");
    model = openai(modelId);
    // searchContextSize "low" keeps the per-call search cost down.
    tools = { web_search: openai.tools.webSearch({ searchContextSize: "low" }) };
  } else if (provider === "gemini") {
    const { google } = await import("@ai-sdk/google");
    modelId = defaultModelId("gemini");
    model = google(modelId);
    tools = { google_search: google.tools.googleSearch({}) };
  } else {
    const { anthropic } = await import("@ai-sdk/anthropic");
    modelId = defaultModelId("anthropic");
    model = anthropic(modelId);
    tools = { web_search: anthropic.tools.webSearch_20250305({ maxUses: 2 }) };
  }

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt,
    tools: tools as Parameters<typeof generateText>[0]["tools"],
    maxOutputTokens: maxOutputTokens("probe"),
    abortSignal: AbortSignal.timeout(60000),
  });

  await recordSpend(guardProvider, modelId, result.usage, {
    fallbackOutputTokens: maxOutputTokens("probe"),
  });

  // result.sources is the SDK-standardized cited-URL list across providers.
  const sources = ((result.sources ?? []) as Array<{ sourceType?: string; url?: string }>)
    .filter((s) => s.sourceType === "url" && typeof s.url === "string")
    .map((s) => s.url as string);

  // A grounded answer with zero citations isn't really grounded — treat as a miss
  // so the caller falls back to the honest parametric (model_knowledge) label.
  if (sources.length === 0) return null;

  groundedCache.set(cacheKey, { at: Date.now(), text: result.text, sources });
  return { text: result.text, sources };
}

export async function queryLLMForVisibility(
  provider: "openai" | "gemini" | "claude" | "ollama",
  prompt: string,
  brandName: string,
  brandDomain: string,
  competitors: string[],
  opts: VisibilityQueryOptions = {}
): Promise<ProviderResult<AIVisibilityResult>> {
  try {
    const systemPrompt = buildSystemPrompt(opts.persona);

    const { makeBrandMatcher, makeCompetitorMatcher } = await import("@/lib/engines/brand-matcher");
    const brandMatcher = makeBrandMatcher(brandName, brandDomain);

    // --- Grounded path: real web search with real cited URLs ----------------
    if (provider !== "ollama" && (opts.grounded ?? groundingDefaultOn())) {
      try {
        const grounded = await runGroundedSearch(provider, systemPrompt, prompt);
        if (grounded) {
          const sourceDomains = [...new Set(grounded.sources.map(hostnameOf).filter(Boolean))];
          const brandMentioned = brandMatcher.mentionedIn(grounded.text) || brandMatcher.citedInUrls(grounded.sources) || brandMatcher.citedInDomains(sourceDomains);
          const brandCited = brandMatcher.citedInUrls(grounded.sources) || brandMatcher.citedInDomains(sourceDomains);
          const competitorMentions: Record<string, boolean> = {};
          const competitorCitations: Record<string, boolean> = {};
          for (const comp of competitors) {
            const cm = makeCompetitorMatcher(comp);
            competitorMentions[comp] = cm.mentionedIn(grounded.text) || cm.citedInDomains(sourceDomains);
            competitorCitations[comp] = cm.citedInUrls(grounded.sources) || cm.citedInDomains(sourceDomains);
          }
          return {
            success: true,
            data: {
              brandMentioned,
              brandCited,
              competitorMentions,
              competitorCitations,
              sourceDomains,
              citedUrls: grounded.sources,
              rawResponse: grounded.text,
              grounded: true,
            },
            creditsUsed: 2,
          };
        }
      } catch {
        // Grounding failed (tool unsupported, web search disabled, timeout) —
        // fall through to the parametric path rather than failing the probe.
      }
    }

    // --- Parametric path: model knowledge only, NO citations ----------------
    let responseText = "";
    if (provider === "ollama") {
      // Self-hosted / local — free, so it bypasses the paid-API budget guard.
      const { generateWithOllama } = await import("@/lib/providers/ollama");
      const out = await generateWithOllama(systemPrompt, prompt);
      if (!out.available) {
        return { success: false, error: out.reason || "Ollama unavailable" };
      }
      responseText = out.text;
    } else {
      const guardProvider: GuardProvider =
        provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic";
      await assertWithinBudget(guardProvider);

      const { generateText } = await import("ai");
      let modelId: string;
      let model: Parameters<typeof generateText>[0]["model"];
      if (provider === "openai") {
        const { openai } = await import("@ai-sdk/openai");
        modelId = defaultModelId("openai");
        model = openai(modelId);
      } else if (provider === "gemini") {
        const { google } = await import("@ai-sdk/google");
        modelId = defaultModelId("gemini");
        model = google(modelId);
      } else {
        const { anthropic } = await import("@ai-sdk/anthropic");
        modelId = defaultModelId("anthropic");
        model = anthropic(modelId);
      }
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt,
        maxOutputTokens: maxOutputTokens("probe"),
        abortSignal: AbortSignal.timeout(45000),
      });
      responseText = result.text;
      await recordSpend(guardProvider, modelId, result.usage);
    }

    // PARAMETRIC (no-browsing): URLs a non-browsing model emits in prose are
    // frequently hallucinated, so we MUST NOT count them as real citations.
    // We measure mentions only; citations are left to grounded paths.
    const brandMentioned = brandMatcher.mentionedIn(responseText);
    const competitorMentions: Record<string, boolean> = {};
    const competitorCitations: Record<string, boolean> = {};
    for (const comp of competitors) {
      competitorMentions[comp] = makeCompetitorMatcher(comp).mentionedIn(responseText);
      competitorCitations[comp] = false;
    }

    return {
      success: true,
      data: {
        brandMentioned,
        brandCited: false,
        competitorMentions,
        competitorCitations,
        sourceDomains: [],
        citedUrls: [],
        rawResponse: responseText,
        grounded: false,
      },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM query failed",
    };
  }
}

export async function generateWithAI(
  systemPrompt: string,
  userPrompt: string,
  model: "fast" | "quality" = "fast"
): Promise<ProviderResult<string>> {
  // Sovereign-first: route through the generate port (Ollama before paid LLMs)
  // with quality gates. In "quality" mode the gates are stricter, so a weak
  // open-model draft transparently upgrades to a paid LLM when one is
  // configured; otherwise the best sovereign output is returned.
  try {
    const { generateContent } = await import("@/lib/providers/generate-router");
    const outcome = await generateContent(systemPrompt, userPrompt, {
      requireStructure: model === "quality",
      minReadingEase: model === "quality" ? 25 : undefined,
    });
    if (outcome.success && outcome.data !== undefined) {
      return { success: true, data: outcome.data, creditsUsed: outcome.creditsUsed };
    }
    return { success: false, error: outcome.error || "AI generation failed" };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI generation failed",
    };
  }
}

function hasKey(name: string): boolean {
  const v = process.env[name];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

/**
 * Structured (schema-constrained) generation. Provider-agnostic: uses whichever
 * frontier key is configured (OpenAI -> Anthropic -> Google) so it works with
 * any paid LLM the operator provides, not OpenAI alone. Budget-guarded.
 */
export async function generateStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: import("zod").ZodType<T>
): Promise<ProviderResult<T>> {
  const provider: GuardProvider | null = hasKey("OPENAI_API_KEY")
    ? "openai"
    : hasKey("ANTHROPIC_API_KEY")
      ? "anthropic"
      : hasKey("GOOGLE_GENERATIVE_AI_API_KEY")
        ? "gemini"
        : null;
  if (!provider) {
    return { success: false, error: "Structured generation needs a paid LLM key (OpenAI/Anthropic/Google)" };
  }
  try {
    await assertWithinBudget(provider);
    const { generateObject } = await import("ai");

    let modelId: string;
    let model;
    if (provider === "openai") {
      const { openai } = await import("@ai-sdk/openai");
      modelId = defaultModelId("openai");
      model = openai(modelId);
    } else if (provider === "anthropic") {
      const { anthropic } = await import("@ai-sdk/anthropic");
      modelId = defaultModelId("anthropic");
      model = anthropic(modelId);
    } else {
      const { google } = await import("@ai-sdk/google");
      modelId = defaultModelId("gemini");
      model = google(modelId);
    }

    const result = await generateObject({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      schema,
      maxOutputTokens: maxOutputTokens("content"),
      abortSignal: AbortSignal.timeout(60000),
    });

    await recordSpend(provider, modelId, result.usage, {
      fallbackOutputTokens: maxOutputTokens("content"),
    });
    return { success: true, data: result.object, creditsUsed: 2 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Structured generation failed",
    };
  }
}
