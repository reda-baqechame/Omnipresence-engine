import { scrapePage } from "@/lib/providers/firecrawl";
import { scrapePageDirect } from "@/lib/crawl/page-scrape";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import type { BrandProfile } from "@/types/database";

const BrandExtractionSchema = z.object({
  brand_name: z.string(),
  brand_voice: z.string(),
  brand_values: z.array(z.string()),
  products_services: z.array(
    z.object({ name: z.string(), description: z.string() })
  ),
  target_audiences: z.array(z.string()),
  proof_points: z.array(
    z.object({ type: z.string(), value: z.string() })
  ),
  faq_database: z.array(
    z.object({ question: z.string(), answer: z.string() })
  ),
  author_persona: z.string(),
  offer_capsules: z.array(
    z.object({ title: z.string(), cta: z.string() })
  ),
});

export async function extractBrandProfile(
  domain: string,
  projectName: string,
  industry?: string
): Promise<Partial<BrandProfile>> {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const scrapeResult = await scrapePage(url);

  let pageContent = "";
  if (scrapeResult.success && scrapeResult.data) {
    const page = scrapeResult.data;
    pageContent = [
      `Title: ${page.title || ""}`,
      `Description: ${page.metaDescription || ""}`,
      `Headings: ${page.headings.map((h) => `H${h.level}: ${h.text}`).join(", ")}`,
      `Schema Types: ${page.schemaTypes.join(", ")}`,
      `Word Count: ${page.wordCount}`,
    ].join("\n");
  } else {
    const direct = await scrapePageDirect(url);
    if (direct) {
      pageContent = [
        `Title: ${direct.title || ""}`,
        `Description: ${direct.metaDescription || ""}`,
        `Headings: ${direct.headings.map((h) => `H${h.level}: ${h.text}`).join(", ")}`,
        `Schema Types: ${direct.schemaTypes.join(", ")}`,
        `Word Count: ${direct.wordCount}`,
        `Internal Links: ${direct.internalLinks}`,
        `External Links: ${direct.externalLinks}`,
      ].join("\n");
    }
  }

  const result = await generateStructured(
    `You are a brand intelligence analyst. Extract structured brand information from website data. Be factual — only extract what you can infer from the data provided.`,
    `Extract brand intelligence for:
Brand: ${projectName}
Domain: ${domain}
Industry: ${industry || "Unknown"}

Website data:
${pageContent}

Extract: brand voice, values, products/services, target audiences, proof points, FAQs, author persona, and offer CTAs.`,
    BrandExtractionSchema
  );

  if (result.success && result.data) {
    return {
      brand_name: result.data.brand_name || projectName,
      brand_voice: result.data.brand_voice,
      brand_values: result.data.brand_values,
      products_services: result.data.products_services,
      target_audiences: result.data.target_audiences,
      proof_points: result.data.proof_points,
      faq_database: result.data.faq_database,
      author_persona: result.data.author_persona,
      offer_capsules: result.data.offer_capsules,
      raw_extraction: result.data as unknown as Record<string, unknown>,
    };
  }

  return {
    brand_name: projectName,
    brand_voice: "Professional and authoritative",
    brand_values: ["Quality", "Trust", "Expertise"],
    products_services: [{ name: projectName, description: `Services offered by ${projectName}` }],
    target_audiences: ["Business owners", "Decision makers"],
    proof_points: [],
    faq_database: [],
    author_persona: "Industry expert",
    offer_capsules: [{ title: "Get Started", cta: "Contact us today" }],
  };
}
