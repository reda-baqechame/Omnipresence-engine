import { z } from "zod";
import { scrapePage } from "@/lib/providers/firecrawl";
import { scrapePageDirect } from "@/lib/crawl/page-scrape";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { resolveCompetitorList, type ResolvedCompetitor } from "@/lib/providers/competitor-resolve";
import { generateTemplatePrompts } from "@/lib/engines/prompt-generator";

/**
 * Onboarding domain intelligence (Trakkr/Otterly pattern, done accurately).
 *
 * One cheap pipeline that turns a bare domain into everything the onboarding
 * wizard needs BEFORE any paid visibility scan runs:
 *   scrape homepage -> infer brand/industry/buyers/competitors (one LLM call)
 *   -> resolve competitor domains with SERP evidence (never guessed)
 *   -> template prompt suggestions (no extra LLM cost).
 *
 * Accuracy guardrail: competitors come from the site's own market context and
 * every domain resolution carries a confidence + evidence URL, so we never
 * repeat Otterly's "pizza chains for an AI consultancy" failure silently — low
 * confidence suggestions are flagged for the user to confirm or reject.
 */

const DomainInferenceSchema = z.object({
  brand_name: z.string(),
  industry: z.string(),
  business_description: z.string(),
  products_services: z.array(z.string()).max(8),
  buyer_categories: z.array(z.string()).max(6),
  likely_competitors: z.array(z.string()).max(8),
  // .nullable(), NOT .optional(): OpenAI strict structured outputs require
  // every property in `required` — optional fields make the whole call fail
  // with "Invalid schema for response_format". Null means "no hint".
  location_hint: z.string().nullable(),
});

export interface OnboardingSuggestedPrompt {
  text: string;
  category: string;
  priority: number;
}

export interface OnboardingAnalysis {
  domain: string;
  brandName: string;
  industry: string;
  businessDescription: string;
  productsServices: string[];
  buyerCategories: string[];
  locationHint: string | null;
  competitors: ResolvedCompetitor[];
  suggestedPrompts: OnboardingSuggestedPrompt[];
  /** False when the homepage could not be scraped AND the LLM had no context —
   *  the wizard falls back to manual entry instead of showing guesses. */
  inferenceGrounded: boolean;
}

async function scrapeHomepage(domain: string): Promise<string> {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const scrapeResult = await scrapePage(url).catch(() => null);
  if (scrapeResult?.success && scrapeResult.data) {
    const page = scrapeResult.data;
    return [
      `Title: ${page.title || ""}`,
      `Description: ${page.metaDescription || ""}`,
      `Headings: ${page.headings.map((h) => `H${h.level}: ${h.text}`).join(", ")}`,
      `Schema Types: ${page.schemaTypes.join(", ")}`,
    ].join("\n");
  }
  const direct = await scrapePageDirect(url).catch(() => null);
  if (direct) {
    return [
      `Title: ${direct.title || ""}`,
      `Description: ${direct.metaDescription || ""}`,
      `Headings: ${direct.headings.map((h) => `H${h.level}: ${h.text}`).join(", ")}`,
      `Schema Types: ${direct.schemaTypes.join(", ")}`,
    ].join("\n");
  }
  return "";
}

function brandNameFromDomain(domain: string): string {
  const base = domain.replace(/^www\./, "").split(".")[0] || domain;
  return base
    .split(/[-_]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export async function analyzeDomainForOnboarding(
  domain: string,
  options?: {
    maxCompetitors?: number;
    maxPrompts?: number;
    /**
     * Skip the per-competitor SERP domain resolution (one search each,
     * sequential — the slowest part of this pipeline). Callers that only need
     * competitor NAMES (e.g. the time-boxed public grader, which matches
     * names inside measured answers) set this false; the onboarding wizard
     * keeps the default true because it shows domains for user confirmation.
     */
    resolveCompetitors?: boolean;
  }
): Promise<OnboardingAnalysis> {
  const maxCompetitors = options?.maxCompetitors ?? 5;
  const maxPrompts = options?.maxPrompts ?? 20;
  const fallbackName = brandNameFromDomain(domain);

  const pageContent = await scrapeHomepage(domain);

  let inference: z.infer<typeof DomainInferenceSchema> | null = null;
  if (pageContent) {
    const result = await generateStructured(
      `You are a market analyst preparing an AI-visibility tracking setup. Infer the business from its homepage data. Be precise about the industry and buyer categories — a wrong industry produces useless tracking prompts. Only name likely competitors that are real companies in the SAME market as this business; if unsure, name fewer. Never invent facts.`,
      `Homepage data for ${domain}:

${pageContent}

Infer: exact brand name, specific industry (e.g. "AI consulting for enterprises", not just "technology"), a one-sentence business description, main products/services, buyer categories (who searches for this), up to ${maxCompetitors + 3} likely direct competitors (company names), and a location hint if the site is clearly local/regional.`,
      DomainInferenceSchema
    ).catch(() => null);
    if (result?.success && result.data) inference = result.data;
  }

  const brandName = inference?.brand_name?.trim() || fallbackName;
  const industry = inference?.industry?.trim() || "";
  const services = (inference?.products_services || []).filter(Boolean);
  const locationHint = inference?.location_hint?.trim() || null;

  const competitorNames = (inference?.likely_competitors || [])
    .map((c) => c.trim())
    .filter((c) => c && c.toLowerCase() !== brandName.toLowerCase());
  const resolveCompetitors = options?.resolveCompetitors !== false;
  const competitors: ResolvedCompetitor[] = competitorNames.length
    ? resolveCompetitors
      ? await resolveCompetitorList(competitorNames, industry || services[0] || "", maxCompetitors)
      : competitorNames.slice(0, maxCompetitors).map((name) => ({
          name,
          domain: null,
          source: "unresolved" as const,
          // LLM-only inference grounded in the homepage: name is usable,
          // domain unknown. High enough to survive a >=0.5 filter, honest
          // about not being SERP-verified.
          confidence: 0.5,
        }))
    : [];

  const confirmedCompetitorNames = resolveCompetitors
    ? competitors.filter((c) => c.domain && c.confidence >= 0.5).map((c) => c.name)
    : competitors.map((c) => c.name);

  const suggestedPrompts = generateTemplatePrompts(
    "00000000-0000-0000-0000-000000000000",
    brandName,
    industry || services[0] || "",
    locationHint || "",
    confirmedCompetitorNames,
    services.length ? services : industry ? [industry] : []
  )
    .slice(0, maxPrompts)
    .map((p) => ({ text: p.text, category: p.category as string, priority: p.priority ?? 50 }));

  return {
    domain,
    brandName,
    industry,
    businessDescription: inference?.business_description?.trim() || "",
    productsServices: services,
    buyerCategories: (inference?.buyer_categories || []).filter(Boolean),
    locationHint,
    competitors,
    suggestedPrompts,
    inferenceGrounded: Boolean(inference),
  };
}
