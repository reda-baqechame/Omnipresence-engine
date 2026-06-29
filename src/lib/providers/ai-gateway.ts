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

export async function queryLLMForVisibility(
  provider: "openai" | "gemini" | "claude" | "ollama",
  prompt: string,
  brandName: string,
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<AIVisibilityResult>> {
  try {
    const systemPrompt = `You are a search assistant. Answer the user's question naturally, citing sources when possible. Be factual and helpful.`;

    let responseText = "";
    let citedUrls: string[] = [];

    if (provider === "ollama") {
      // Self-hosted / local — free, so it bypasses the paid-API budget guard.
      const { generateWithOllama } = await import("@/lib/providers/ollama");
      const out = await generateWithOllama(systemPrompt, prompt);
      if (!out.available) {
        return { success: false, error: out.reason || "Ollama unavailable" };
      }
      responseText = out.text;
    } else {
      // Paid providers — enforce the spend budget + rate limit before calling.
      const guardProvider: GuardProvider =
        provider === "openai" ? "openai" : provider === "gemini" ? "gemini" : "anthropic";
      await assertWithinBudget(guardProvider);

      const { generateText } = await import("ai");
      let modelId: string;
      let model;
      if (provider === "openai") {
        const { openai } = await import("@ai-sdk/openai");
        modelId = "gpt-4o-mini";
        model = openai(modelId);
      } else if (provider === "gemini") {
        const { google } = await import("@ai-sdk/google");
        modelId = "gemini-2.0-flash";
        model = google(modelId);
      } else {
        const { anthropic } = await import("@ai-sdk/anthropic");
        modelId = "claude-3-5-haiku-latest";
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

    // IMPORTANT: this is the PARAMETRIC (no-browsing) path. URLs a non-browsing
    // model emits in prose are frequently hallucinated, so we MUST NOT count them
    // as real citations. We measure mentions only here; citations are left to the
    // grounded providers (Perplexity / SERP / AI-UI capture). Anything else would
    // record fabricated "source domains" as if measured.
    const { makeBrandMatcher, makeCompetitorMatcher } = await import("@/lib/engines/brand-matcher");
    const brandMatcher = makeBrandMatcher(brandName, brandDomain);

    const brandMentioned = brandMatcher.mentionedIn(responseText);
    const brandCited = false;
    citedUrls = [];

    const competitorMentions: Record<string, boolean> = {};
    const competitorCitations: Record<string, boolean> = {};
    for (const comp of competitors) {
      competitorMentions[comp] = makeCompetitorMatcher(comp).mentionedIn(responseText);
      competitorCitations[comp] = false;
    }

    const sourceDomains: string[] = [];

    return {
      success: true,
      data: {
        brandMentioned,
        brandCited,
        competitorMentions,
        competitorCitations,
        sourceDomains,
        citedUrls,
        rawResponse: responseText,
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
      modelId = "gpt-4o-mini";
      model = openai(modelId);
    } else if (provider === "anthropic") {
      const { anthropic } = await import("@ai-sdk/anthropic");
      modelId = "claude-3-5-haiku-latest";
      model = anthropic(modelId);
    } else {
      const { google } = await import("@ai-sdk/google");
      modelId = "gemini-2.0-flash";
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
