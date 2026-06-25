import { z } from "zod";
import { scrapePage } from "@/lib/providers/firecrawl";
import { generateStructured } from "@/lib/providers/ai-gateway";

/**
 * Active answer-first passage rewriter (AEO Lever 2).
 * Turns existing page content into the structure AI engines quote verbatim:
 *  - a 40-80 word direct answer lead per key question
 *  - a 120-180 word self-contained supporting block
 *  - extractable FAQ pairs for FAQPage schema
 */

const RewriteSchema = z.object({
  rewrites: z.array(
    z.object({
      heading: z.string(),
      answerFirst: z.string(),
      supporting: z.string(),
    })
  ),
  suggestedFaqs: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    })
  ),
});

export interface PassageRewriteResult {
  url: string;
  rewrites: Array<{ heading: string; answerFirst: string; supporting: string }>;
  suggestedFaqs: Array<{ question: string; answer: string }>;
  source: "ai" | "unavailable";
  error?: string;
}

export async function generatePassageRewrites(
  domain: string,
  brandName: string,
  url?: string
): Promise<PassageRewriteResult> {
  const target = url || (domain.startsWith("http") ? domain : `https://${domain}`);

  const scraped = await scrapePage(target);
  if (!scraped.success || !scraped.data) {
    return {
      url: target,
      rewrites: [],
      suggestedFaqs: [],
      source: "unavailable",
      error: scraped.error || "Could not fetch page content",
    };
  }

  const page = scraped.data;
  const headings = page.headings
    .filter((h) => h.level === 2 || h.level === 3)
    .map((h) => h.text)
    .filter(Boolean)
    .slice(0, 8);
  const paragraphs = (page.paragraphs || []).filter((p) => p.split(/\s+/).length >= 12).slice(0, 12);

  const context = `Brand: ${brandName}
Page: ${target}
Title: ${page.title || "(none)"}
Meta description: ${page.metaDescription || "(none)"}

Existing section headings:
${headings.map((h) => `- ${h}`).join("\n") || "(none detected)"}

Existing content excerpts:
${paragraphs.map((p) => `- ${p.slice(0, 320)}`).join("\n") || "(thin content)"}`;

  const result = await generateStructured(
    `You are an AEO (answer-engine optimization) editor. You rewrite web copy so AI engines (ChatGPT, Perplexity, Google AI Overviews) quote it verbatim. Rules: (1) every section opens with a direct, self-contained 40-80 word answer to the implied buyer question; (2) follow with a 120-180 word supporting block dense with specifics, numbers, and concrete detail; (3) never invent facts, prices, or statistics not implied by the source — keep claims defensible; (4) phrase headings as natural buyer questions.`,
    `Rewrite the most important sections of this page into answer-first passages, and propose 3-5 FAQ pairs suitable for FAQPage schema.

${context}

Return 3-6 rewrites (one per key question) plus 3-5 FAQs. Keep answers factual and grounded in the source content.`,
    RewriteSchema
  );

  if (result.success && result.data) {
    return {
      url: target,
      rewrites: result.data.rewrites,
      suggestedFaqs: result.data.suggestedFaqs,
      source: "ai",
    };
  }

  return {
    url: target,
    rewrites: [],
    suggestedFaqs: [],
    source: "unavailable",
    error: result.error || "AI rewrite unavailable (configure an LLM API key)",
  };
}
