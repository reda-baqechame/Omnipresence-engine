import type { ProviderResult, SearchResult } from "./types";

export async function searchPerplexity(
  query: string,
  brandDomain: string,
  competitors: string[]
): Promise<
  ProviderResult<{
    results: SearchResult[];
    brandMentioned: boolean;
    brandCited: boolean;
    competitorMentions: Record<string, boolean>;
    sourceDomains: string[];
  }>
> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { success: false, error: "Perplexity API key not configured" };
  }

  try {
    const response = await fetch("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: 10,
      }),
    });

    if (!response.ok) {
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      results: Array<{ title: string; url: string; snippet: string }>;
    };

    const results: SearchResult[] = (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      domain: (() => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })(),
    }));

    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");
    const allText = results.map((r) => `${r.title} ${r.snippet}`).join(" ").toLowerCase();

    const brandMentioned = allText.includes(domainLower.split(".")[0]);
    const brandCited = results.some((r) => r.domain.includes(domainLower.split(".")[0]));

    const competitorMentions: Record<string, boolean> = {};
    for (const comp of competitors) {
      competitorMentions[comp] = allText.includes(comp.toLowerCase());
    }

    const sourceDomains = [...new Set(results.map((r) => r.domain).filter(Boolean))];

    return {
      success: true,
      data: { results, brandMentioned, brandCited, competitorMentions, sourceDomains },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Perplexity search failed",
    };
  }
}

export async function queryPerplexitySonar(
  prompt: string,
  brandName: string,
  brandDomain: string,
  competitors: string[]
): Promise<
  ProviderResult<{
    answer: string;
    brandMentioned: boolean;
    brandCited: boolean;
    competitorMentions: Record<string, boolean>;
    citations: string[];
  }>
> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { success: false, error: "Perplexity API key not configured" };
  }

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Perplexity Sonar error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };

    const answer = data.choices?.[0]?.message?.content || "";
    const citations = data.citations || [];
    const lowerAnswer = answer.toLowerCase();
    const brandLower = brandName.toLowerCase();
    const domainLower = brandDomain.toLowerCase().replace(/^www\./, "");

    const brandMentioned =
      lowerAnswer.includes(brandLower) || lowerAnswer.includes(domainLower);
    const brandCited = citations.some((c) => c.toLowerCase().includes(domainLower));

    const competitorMentions: Record<string, boolean> = {};
    for (const comp of competitors) {
      competitorMentions[comp] = lowerAnswer.includes(comp.toLowerCase());
    }

    return {
      success: true,
      data: { answer, brandMentioned, brandCited, competitorMentions, citations },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Perplexity Sonar failed",
    };
  }
}
