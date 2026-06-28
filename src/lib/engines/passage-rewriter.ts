import { z } from "zod";
import { scrapePage } from "@/lib/providers/firecrawl";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { assembleStructuredDoc, type StructuredDoc } from "@/lib/engines/structural-aeo";
import { autoGeoInstructions } from "@/lib/engines/autogeo";

/**
 * Active answer-first passage rewriter (AEO Lever 2).
 * Turns existing page content into the structure AI engines quote verbatim:
 *  - a 40-80 word direct answer lead per key question
 *  - a 120-180 word self-contained supporting block
 *  - extractable FAQ pairs for FAQPage schema
 */

const RewriteSchema = z.object({
  title: z.string().optional(),
  definition: z
    .object({ term: z.string(), text: z.string() })
    .optional(),
  rewrites: z.array(
    z.object({
      heading: z.string(),
      answerFirst: z.string(),
      supporting: z.string(),
    })
  ),
  steps: z
    .object({ name: z.string(), items: z.array(z.string()) })
    .optional(),
  comparison: z
    .object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())) })
    .optional(),
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
  /** Assembled, structurally-optimized document + JSON-LD + deterministic QC. */
  structured?: StructuredDoc;
  source: "ai" | "unavailable";
  error?: string;
}

export interface PassageRewriteOptions {
  /** Inject the AutoGEO (MIT) rule set to maximize generative-engine citation lift. */
  autoGeo?: boolean;
}

export async function generatePassageRewrites(
  domain: string,
  brandName: string,
  url?: string,
  options?: PassageRewriteOptions
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

  const autoGeoBlock = options?.autoGeo ? `\n\n${autoGeoInstructions()}` : "";
  const result = await generateStructured(
    `You are an AEO (answer-engine optimization) editor. You rewrite web copy so AI engines (ChatGPT, Perplexity, Google AI Overviews) quote it verbatim. Rules: (1) every section opens with a direct, self-contained 40-80 word answer to the implied buyer question; (2) follow with a 120-180 word supporting block dense with specifics, numbers, and concrete detail; (3) never invent facts, prices, or statistics not implied by the source — keep claims defensible; (4) phrase headings as natural buyer questions; (5) when the topic involves a process, return an ordered "steps" list (for HowTo schema); (6) when comparing options, return a "comparison" table (headers + rows); (7) provide a "definition" block (term + a 40-80 word self-contained definition).${autoGeoBlock}`,
    `Rewrite the most important sections of this page into answer-first passages, and propose 3-5 FAQ pairs suitable for FAQPage schema. Where applicable, also return ordered steps, a comparison table, and a definition block.

${context}

Return 3-6 rewrites (one per key question) plus 3-5 FAQs, and (when relevant) steps/comparison/definition. Keep everything factual and grounded in the source content.`,
    RewriteSchema
  );

  if (result.success && result.data) {
    const d = result.data;
    const structured = assembleStructuredDoc({
      title: d.title || `${brandName} — Answer-Ready Guide`,
      definition: d.definition,
      sections: d.rewrites.map((r) => ({
        heading: r.heading,
        answerFirst: r.answerFirst,
        supporting: r.supporting,
      })),
      steps: d.steps,
      comparison: d.comparison,
      faqs: d.suggestedFaqs,
    });
    return {
      url: target,
      rewrites: d.rewrites,
      suggestedFaqs: d.suggestedFaqs,
      structured,
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
