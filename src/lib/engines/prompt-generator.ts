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

const CATEGORY_TEMPLATES: Record<PromptCategory, string[]> = {
  best_of: ["best {service} in {location}", "top rated {service} companies", "best {service} for {audience}"],
  comparison: ["{brand} vs {competitor}", "{competitor} alternatives", "compare {service} providers in {location}"],
  local: ["{service} near me", "{service} in {location}", "24/7 {service} {location}"],
  problem_aware: ["why is my {problem}", "how to fix {problem}", "signs you need {service}"],
  solution_aware: ["who fixes {problem} fast", "best way to {solution}", "how much does {service} cost"],
  pricing: ["{service} cost in {location}", "how much does {service} cost", "affordable {service} {location}"],
  trust: ["is {brand} reliable", "{brand} reviews", "is {brand} legit"],
  alternatives: ["best alternative to {competitor}", "{competitor} vs other options", "cheaper than {competitor}"],
  reviews: ["top rated {service} company", "{brand} customer reviews", "best reviewed {service} {location}"],
  transactional: ["book {service} today", "hire {service} {location}", "schedule {service} appointment"],
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
  return generateFromTemplates(projectId, brandName, industry, location, competitors, services);
}

function generateFromTemplates(
  projectId: string,
  brandName: string,
  industry: string,
  location: string,
  competitors: string[],
  services: string[]
): Omit<Prompt, "id" | "created_at">[] {
  const prompts: Omit<Prompt, "id" | "created_at">[] = [];
  const service = services[0] || industry;

  for (const [category, templates] of Object.entries(CATEGORY_TEMPLATES)) {
    for (const template of templates) {
      let text = template
        .replace("{brand}", brandName)
        .replace("{service}", service)
        .replace("{location}", location)
        .replace("{audience}", "businesses")
        .replace("{problem}", `${service} issues`)
        .replace("{solution}", service);

      if (template.includes("{competitor}") && competitors.length > 0) {
        for (const comp of competitors.slice(0, 2)) {
          prompts.push({
            project_id: projectId,
            text: text.replace("{competitor}", comp),
            category: category as PromptCategory,
            priority: category === "transactional" || category === "comparison" ? 80 : 50,
            is_tracked: true,
          });
        }
      } else if (!template.includes("{competitor}")) {
        prompts.push({
          project_id: projectId,
          text,
          category: category as PromptCategory,
          priority: category === "transactional" ? 85 : 50,
          is_tracked: true,
        });
      }
    }
  }

  return prompts;
}
