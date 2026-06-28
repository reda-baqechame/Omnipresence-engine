import { generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import type { Prompt, PromptCategory } from "@/types/database";

const PromptSchema = z.object({
  prompts: z.array(
    z.object({
      text: z.string(),
      category: z.enum([
        "best_of", "comparison", "local", "problem_aware", "solution_aware",
        "pricing", "trust", "alternatives", "reviews", "transactional",
      ]),
      priority: z.number().min(1).max(100),
    })
  ),
});

// Universal, intent-rich templates that work across SaaS, e-commerce, B2B,
// media, and local businesses — not just local-service queries. Brand- and
// category-aware prompts are what actually surface real visibility in SERPs and
// AI answers, so a strong brand shows real presence instead of fake zeros.
const CATEGORY_TEMPLATES: Record<PromptCategory, string[]> = {
  best_of: ["best {service}", "best {service} for {audience}", "top {service} tools"],
  comparison: ["{brand} vs {competitor}", "{competitor} alternatives", "{service} comparison"],
  local: ["best {service} in {location}", "{service} near me"],
  problem_aware: ["how to choose {service}", "do I need {service}", "common {service} mistakes"],
  solution_aware: ["what is the best {service}", "best {service} software", "how to get started with {service}"],
  pricing: ["{service} pricing", "how much does {service} cost", "{brand} pricing"],
  trust: ["is {brand} legit", "is {brand} worth it", "{brand} pros and cons"],
  alternatives: ["best alternative to {competitor}", "tools like {competitor}", "{competitor} vs {brand}"],
  reviews: ["{brand} reviews", "{service} reviews", "top rated {service}"],
  transactional: ["{service} free trial", "buy {service}", "{brand} sign up"],
};

// Commercial/brand intent weighting. Brand-aware and category queries rank
// highest so the top-N selected for quick audits reflect real visibility.
const CATEGORY_PRIORITY: Record<PromptCategory, number> = {
  reviews: 90,
  best_of: 88,
  comparison: 86,
  trust: 84,
  alternatives: 80,
  solution_aware: 78,
  pricing: 74,
  transactional: 70,
  problem_aware: 64,
  local: 55,
};

export async function generatePromptUniverse(
  projectId: string,
  brandName: string,
  industry: string,
  location: string,
  competitors: string[],
  targetBuyer: string,
  productsServices: string[] = [],
  count = 100
): Promise<Omit<Prompt, "id" | "created_at">[]> {
  const services = productsServices.length > 0 ? productsServices : [industry];

  const result = await generateStructured(
    `You are a search intent analyst. Generate realistic buyer-intent prompts that people would type into Google, ChatGPT, Perplexity, or other AI search engines when looking for products/services like the one described. Generate diverse prompts across all categories.`,
    `Generate ${count} buyer-intent search prompts for:

Brand: ${brandName}
Industry: ${industry}
Location: ${location}
Target Buyer: ${targetBuyer}
Services: ${services.join(", ")}
Competitors: ${competitors.join(", ")}

Categories to cover: best_of, comparison, local, problem_aware, solution_aware, pricing, trust, alternatives, reviews, transactional

Make prompts natural and realistic. Include location-specific prompts. Include competitor comparison prompts. Prioritize high-commercial-intent prompts higher (70-100).`,
    PromptSchema
  );

  if (result.success && result.data) {
    return result.data.prompts.map((p) => ({
      project_id: projectId,
      text: p.text,
      category: p.category as PromptCategory,
      priority: p.priority,
      is_tracked: p.priority >= 50,
    }));
  }

  // Fallback: template-based generation
  return generateTemplatePrompts(projectId, brandName, industry, location, competitors, services);
}

/** Template-only prompts (no LLM) — used for public audit and offline fallback. */
export function generateTemplatePrompts(
  projectId: string,
  brandName: string,
  industry: string,
  location: string,
  competitors: string[],
  services: string[]
): Omit<Prompt, "id" | "created_at">[] {
  const prompts: Omit<Prompt, "id" | "created_at">[] = [];
  const service = services[0] || industry;
  const audience = `${service} buyers`;
  // Only generate location-bound prompts when a real, specific location is given
  // (default "United States" or empty is not specific enough to be meaningful).
  const hasRealLocation = Boolean(location) && location.trim().toLowerCase() !== "united states";

  const fill = (template: string, competitor?: string) =>
    template
      .replace("{brand}", brandName)
      .replace("{service}", service)
      .replace("{location}", location)
      .replace("{audience}", audience)
      .replace("{competitor}", competitor ?? "")
      .trim();

  const seen = new Set<string>();
  const push = (text: string, category: PromptCategory, priority: number) => {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    prompts.push({ project_id: projectId, text, category, priority, is_tracked: priority >= 50 });
  };

  for (const [category, templates] of Object.entries(CATEGORY_TEMPLATES)) {
    const cat = category as PromptCategory;
    if (cat === "local" && !hasRealLocation) continue;
    const basePriority = CATEGORY_PRIORITY[cat] ?? 50;
    for (const template of templates) {
      // Brand-anchored prompts almost always surface the brand → real signal.
      const brandBonus = template.includes("{brand}") ? 3 : 0;
      if (template.includes("{competitor}")) {
        if (competitors.length === 0) continue;
        for (const comp of competitors.slice(0, 2)) {
          push(fill(template, comp), cat, basePriority + brandBonus);
        }
      } else {
        push(fill(template), cat, basePriority + brandBonus);
      }
    }
  }

  return prompts.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
