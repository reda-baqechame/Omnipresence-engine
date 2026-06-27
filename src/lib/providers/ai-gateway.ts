import type { AIVisibilityResult, ProviderResult } from "./types";

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
  provider: "openai" | "gemini" | "claude",
  prompt: string,
  brandName: string,
  brandDomain: string,
  competitors: string[]
): Promise<ProviderResult<AIVisibilityResult>> {
  try {
    const systemPrompt = `You are a search assistant. Answer the user's question naturally, citing sources when possible. Be factual and helpful.`;

    let responseText = "";
    let citedUrls: string[] = [];

    if (provider === "openai") {
      const { generateText } = await import("ai");
      const { openai } = await import("@ai-sdk/openai");
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        prompt,
        abortSignal: AbortSignal.timeout(45000),
      });
      responseText = result.text;
    } else if (provider === "gemini") {
      const { generateText } = await import("ai");
      const { google } = await import("@ai-sdk/google");
      const result = await generateText({
        model: google("gemini-2.0-flash"),
        system: systemPrompt,
        prompt,
        abortSignal: AbortSignal.timeout(45000),
      });
      responseText = result.text;
    } else {
      const { generateText } = await import("ai");
      const { anthropic } = await import("@ai-sdk/anthropic");
      const result = await generateText({
        model: anthropic("claude-3-5-haiku-latest"),
        system: systemPrompt,
        prompt,
        abortSignal: AbortSignal.timeout(45000),
      });
      responseText = result.text;
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
  try {
    const { generateText } = await import("ai");
    const { openai } = await import("@ai-sdk/openai");

    const modelId = model === "quality" ? "gpt-4o" : "gpt-4o-mini";
    const result = await generateText({
      model: openai(modelId),
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: AbortSignal.timeout(60000),
    });

    return { success: true, data: result.text, creditsUsed: model === "quality" ? 5 : 1 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "AI generation failed",
    };
  }
}

export async function generateStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: import("zod").ZodType<T>
): Promise<ProviderResult<T>> {
  try {
    const { generateObject } = await import("ai");
    const { openai } = await import("@ai-sdk/openai");

    const result = await generateObject({
      model: openai("gpt-4o-mini"),
      system: systemPrompt,
      prompt: userPrompt,
      schema,
      abortSignal: AbortSignal.timeout(60000),
    });

    return { success: true, data: result.object, creditsUsed: 2 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Structured generation failed",
    };
  }
}
