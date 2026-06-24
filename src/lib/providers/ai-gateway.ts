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
      });
      responseText = result.text;
    } else if (provider === "gemini") {
      const { generateText } = await import("ai");
      const { google } = await import("@ai-sdk/google");
      const result = await generateText({
        model: google("gemini-2.0-flash"),
        system: systemPrompt,
        prompt,
      });
      responseText = result.text;
    } else {
      const { generateText } = await import("ai");
      const { anthropic } = await import("@ai-sdk/anthropic");
      const result = await generateText({
        model: anthropic("claude-3-5-haiku-latest"),
        system: systemPrompt,
        prompt,
      });
      responseText = result.text;
    }

    const urlRegex = /https?:\/\/[^\s)>\]]+/g;
    citedUrls = (responseText.match(urlRegex) || []).map((u) => u.replace(/[.,;]+$/, ""));

    const lowerResponse = responseText.toLowerCase();
    const brandLower = brandName.toLowerCase();
    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");

    const brandMentioned =
      lowerResponse.includes(brandLower) || lowerResponse.includes(domainLower);
    const brandCited = citedUrls.some(
      (u) => u.toLowerCase().includes(domainLower)
    );

    const competitorMentions: Record<string, boolean> = {};
    const competitorCitations: Record<string, boolean> = {};
    for (const comp of competitors) {
      const compLower = comp.toLowerCase();
      competitorMentions[comp] = lowerResponse.includes(compLower);
      competitorCitations[comp] = citedUrls.some((u) =>
        u.toLowerCase().includes(compLower.replace(/\s+/g, ""))
      );
    }

    const sourceDomains = [
      ...new Set(
        citedUrls.map((u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, "");
          } catch {
            return "";
          }
        }).filter(Boolean)
      ),
    ];

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
    });

    return { success: true, data: result.object, creditsUsed: 2 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Structured generation failed",
    };
  }
}
