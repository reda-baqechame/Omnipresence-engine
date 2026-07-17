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
  if (provider === "gemini") {
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "";
    if (key.startsWith("AQ.")) return env("AI_GEMINI_MODEL", "gemini-flash-latest");
    return env("AI_GEMINI_MODEL", "gemini-2.5-flash");
  }
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
  /**
   * "reuse" (default): serve identical recent probes from the shared cache.
   * "record": always call the provider — required for multi-run panels where
   * repeated-run variance is the product.
   */
  cacheMode?: "reuse" | "record";
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
// answer + sources by (provider, systemPrompt, prompt) for a window so repeated
// probes of the same cell (multi-engine fan-out, retries, identical prompts
// across tenants) don't re-bill. Two layers: in-memory (per warm instance) and
// a shared Supabase table (cross-instance AND cross-tenant — the Master Plan
// economics guardrail). Panel runs pass cacheMode="record" to bypass reads so
// repeated-run volatility stays a real measurement.
const GROUNDED_CACHE_TTL_MS = Math.max(0, Number(process.env.AI_PROBE_CACHE_TTL_MS) || 6 * 60 * 60 * 1000);
const groundedCache = new Map<string, { at: number; text: string; sources: string[] }>();

function groundedCacheKey(provider: string, systemPrompt: string, prompt: string): string {
  // System prompt participates (persona-conditioned answers must never be
  // served for unconditioned probes or vice versa); hash it to keep keys short.
  let h = 0;
  for (let i = 0; i < systemPrompt.length; i++) h = (h * 31 + systemPrompt.charCodeAt(i)) >>> 0;
  return `${provider}::${h.toString(36)}::${prompt.trim().toLowerCase().slice(0, 400)}`;
}

async function probeCacheDb() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function readProbeCacheDb(
  cacheKey: string
): Promise<{ text: string; sources: string[] } | null> {
  try {
    const sb = await probeCacheDb();
    if (!sb) return null;
    const { data } = await sb
      .from("probe_cache")
      .select("answer, sources, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (!data) return null;
    if (Date.now() - new Date(data.created_at).getTime() > GROUNDED_CACHE_TTL_MS) return null;
    return {
      text: String(data.answer),
      sources: Array.isArray(data.sources) ? (data.sources as string[]) : [],
    };
  } catch {
    return null; // Cache is an optimization — never fail a probe over it.
  }
}

async function writeProbeCacheDb(
  cacheKey: string,
  provider: string,
  text: string,
  sources: string[],
  modelId?: string
): Promise<void> {
  try {
    const sb = await probeCacheDb();
    if (!sb) return;
    await sb.from("probe_cache").upsert({
      cache_key: cacheKey,
      provider,
      answer: text.slice(0, 20000),
      sources: sources.slice(0, 40),
      model_id: modelId || null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort.
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isRetryableLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|quota|rate.?limit|resource.?exhausted|overloaded/i.test(msg);
}

function isGeminiModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|not supported|404/i.test(msg);
}

function geminiModelChain(): string[] {
  const primary = defaultModelId("gemini");
  return [...new Set([primary, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"])];
}

async function generateGroundedWithProvider(
  provider: "openai" | "gemini" | "claude",
  systemPrompt: string,
  prompt: string
): Promise<{ text: string; sources: string[]; modelId: string }> {
  const guardProvider: GuardProvider =
    provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic";

  if (provider === "gemini") {
    const { usesGeminiExpressKey, generateGeminiRestWithFallback } = await import("@/lib/providers/gemini-rest");
    if (usesGeminiExpressKey()) {
      const out = await generateGeminiRestWithFallback(systemPrompt, prompt);
      await recordSpend(guardProvider, out.modelId, undefined, {
        fallbackOutputTokens: maxOutputTokens("probe"),
      });
      return { text: out.text, sources: [], modelId: out.modelId };
    }
  }

  const { generateText } = await import("ai");
  const attempts =
    provider === "gemini"
      ? geminiModelChain().map((modelId) => ({ modelId, providerKind: "gemini" as const }))
      : [{ modelId: defaultModelId(provider === "openai" ? "openai" : "anthropic"), providerKind: provider }];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      let model: Parameters<typeof generateText>[0]["model"];
      let tools: Record<string, unknown>;
      if (attempt.providerKind === "openai") {
        const { openai } = await import("@ai-sdk/openai");
        model = openai(attempt.modelId);
        tools = { web_search: openai.tools.webSearch({ searchContextSize: "low" }) };
      } else if (attempt.providerKind === "gemini") {
        const { google } = await import("@ai-sdk/google");
        model = google(attempt.modelId);
        tools = { google_search: google.tools.googleSearch({}) };
      } else {
        const { anthropic } = await import("@ai-sdk/anthropic");
        model = anthropic(attempt.modelId);
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

      await recordSpend(guardProvider, attempt.modelId, result.usage, {
        fallbackOutputTokens: maxOutputTokens("probe"),
      });

      const sources = ((result.sources ?? []) as Array<{ sourceType?: string; url?: string }>)
        .filter((s) => s.sourceType === "url" && typeof s.url === "string")
        .map((s) => s.url as string);

      if (!result.text.trim()) continue;
      return { text: result.text, sources, modelId: attempt.modelId };
    } catch (err) {
      lastError = err;
      if (provider === "gemini" && (isRetryableLlmError(err) || isGeminiModelError(err))) continue;
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("grounded generation failed");
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
  prompt: string,
  cacheMode: "reuse" | "record" = "reuse"
): Promise<{ text: string; sources: string[]; cached: boolean } | null> {
  const cacheKey = groundedCacheKey(provider, systemPrompt, prompt);
  if (cacheMode === "reuse") {
    const cached = groundedCache.get(cacheKey);
    if (cached && Date.now() - cached.at < GROUNDED_CACHE_TTL_MS) {
      return { text: cached.text, sources: cached.sources, cached: true };
    }
    const persisted = await readProbeCacheDb(cacheKey);
    if (persisted) {
      groundedCache.set(cacheKey, { at: Date.now(), ...persisted });
      return { ...persisted, cached: true };
    }
  }

  const guardProvider: GuardProvider =
    provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic";
  await assertWithinBudget(guardProvider);

  try {
    const result = await generateGroundedWithProvider(provider, systemPrompt, prompt);
    groundedCache.set(cacheKey, { at: Date.now(), text: result.text, sources: result.sources });
    // Fresh answers always refresh the shared cache — even "record" runs feed
    // future reuse reads.
    await writeProbeCacheDb(cacheKey, provider, result.text, result.sources, result.modelId);
    return { text: result.text, sources: result.sources, cached: false };
  } catch {
    return null;
  }
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
        const grounded = await runGroundedSearch(provider, systemPrompt, prompt, opts.cacheMode ?? "reuse");
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
              cached: grounded.cached,
            },
            creditsUsed: grounded.cached ? 0 : 2,
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
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt,
          maxOutputTokens: maxOutputTokens("probe"),
          abortSignal: AbortSignal.timeout(45000),
        });
        responseText = result.text;
        await recordSpend(guardProvider, modelId, result.usage);
      } else if (provider === "gemini") {
        const { usesGeminiExpressKey, generateGeminiRestWithFallback } = await import("@/lib/providers/gemini-rest");
        if (usesGeminiExpressKey()) {
          const out = await generateGeminiRestWithFallback(systemPrompt, prompt);
          responseText = out.text;
          modelId = out.modelId;
          await recordSpend(guardProvider, modelId, undefined, {
            fallbackOutputTokens: maxOutputTokens("probe"),
          });
        } else {
        const { google } = await import("@ai-sdk/google");
        const models = geminiModelChain();
        let lastGeminiError: unknown;
        for (const mid of models) {
          try {
            modelId = mid;
            model = google(mid);
            const result = await generateText({
              model,
              system: systemPrompt,
              prompt,
              maxOutputTokens: maxOutputTokens("probe"),
              abortSignal: AbortSignal.timeout(45000),
            });
            responseText = result.text;
            await recordSpend(guardProvider, modelId, result.usage);
            lastGeminiError = null;
            break;
          } catch (err) {
            lastGeminiError = err;
            if (!isRetryableLlmError(err) && !isGeminiModelError(err)) throw err;
          }
        }
        if (!responseText && lastGeminiError) throw lastGeminiError;
        }
      } else {
        const { anthropic } = await import("@ai-sdk/anthropic");
        modelId = defaultModelId("anthropic");
        model = anthropic(modelId);
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
