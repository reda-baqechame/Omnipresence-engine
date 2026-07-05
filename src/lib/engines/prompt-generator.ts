import { keywordsToConversationalPrompts } from "@/lib/engines/kw-to-prompts";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { z } from "zod";
import type { Prompt, PromptCategory } from "@/types/database";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";

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
  const kwPrompts = await keywordsToConversationalPrompts(
    [industry, ...services, ...competitors.slice(0, 3)],
    { max: Math.min(20, count), industry }
  );
  const fromKw: Omit<Prompt, "id" | "created_at">[] = kwPrompts.map((p) => ({
    project_id: projectId,
    text: p.text,
    category: classifyPrompt(p.text),
    priority: p.priority,
    is_tracked: p.priority >= 50,
  }));

  const serpPrompts = await generateSerpResearchedPrompts(
    projectId,
    brandName,
    industry,
    location,
    competitors,
    services,
    count
  );
  if (serpPrompts.length >= Math.min(8, count)) {
    return dedupePrompts([...fromKw, ...serpPrompts]).slice(0, count);
  }

  const result = await generateStructured(
    `You are a search intent analyst. Generate buyer-intent prompts only from the brand, competitor, service, and SERP context provided. Do not invent claims about ratings, years in business, awards, pricing, or capabilities.`,
    `Generate ${count} buyer-intent search prompts for:

Brand: ${brandName}
Industry: ${industry}
Location: ${location}
Target Buyer: ${targetBuyer}
Services: ${services.join(", ")}
Competitors: ${competitors.join(", ")}
SERP-researched seed prompts already found:
${serpPrompts.map((p) => `- ${p.text}`).join("\n")}

Categories to cover: best_of, comparison, local, problem_aware, solution_aware, pricing, trust, alternatives, reviews, transactional

Make prompts natural and realistic. Include competitor comparison prompts only for named competitors. Include location prompts only when a specific city/region was provided. Prioritize high-commercial-intent prompts higher (70-100).`,
    PromptSchema
  );

  if (result.success && result.data) {
    const merged = [...fromKw, ...serpPrompts, ...result.data.prompts.map((p) => ({
      project_id: projectId,
      text: p.text,
      category: p.category as PromptCategory,
      priority: p.priority,
      is_tracked: p.priority >= 50,
    }))];
    return dedupePrompts(merged).slice(0, count);
  }

  return dedupePrompts([...fromKw, ...serpPrompts]).slice(0, count);
}

async function generateSerpResearchedPrompts(
  projectId: string,
  brandName: string,
  industry: string,
  location: string,
  competitors: string[],
  services: string[],
  count: number
): Promise<Omit<Prompt, "id" | "created_at">[]> {
  const prompts: Omit<Prompt, "id" | "created_at">[] = [];
  const seen = new Set<string>();
  const service = services.find(Boolean) || industry;
  const hasLocation = Boolean(location) && location.trim().toLowerCase() !== "united states";
  const seeds = [
    service && `best ${service}`,
    service && `${service} reviews`,
    service && `how to choose ${service}`,
    `${brandName} reviews`,
    competitors[0] && `${brandName} vs ${competitors[0]}`,
    competitors[0] && `${competitors[0]} alternatives`,
    hasLocation && service ? `best ${service} in ${location}` : null,
  ].filter(Boolean) as string[];

  const add = (text: string, category: PromptCategory, priority: number) => {
    const cleaned = text.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
    const key = cleaned.toLowerCase();
    if (!cleaned || cleaned.length < 8 || seen.has(key)) return;
    seen.add(key);
    prompts.push({ project_id: projectId, text: cleaned.slice(0, 180), category, priority, is_tracked: priority >= 50 });
  };

  for (const seed of seeds.slice(0, 8)) {
    add(seed, classifyPrompt(seed), 88);
    const serp = await searchGoogleOrganicRouter(seed, location || "United States", "", competitors).catch(() => null);
    if (!serp?.success || !serp.data) continue;
    for (const result of serp.data.organicResults.slice(0, 5)) {
      const titlePrompt = titleToPrompt(result.title, brandName, service);
      if (titlePrompt) add(titlePrompt, classifyPrompt(titlePrompt), 72);
      if (prompts.length >= count) return dedupePrompts(prompts);
    }
  }

  return dedupePrompts(prompts);
}

function titleToPrompt(title: string, brandName: string, service: string): string | null {
  const cleaned = title
    .replace(/\s*[-|:]\s*.*/, "")
    .replace(new RegExp(`\\b${escapeRegExp(brandName)}\\b`, "gi"), brandName)
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 10) return null;
  if (/^(best|top|how|what|why|is|are|does|can|should)\b/i.test(cleaned)) return cleaned;
  if (service) return `what to know about ${cleaned}`;
  return cleaned;
}

function classifyPrompt(text: string): PromptCategory {
  const t = text.toLowerCase();
  if (t.includes(" vs ") || t.includes("versus")) return "comparison";
  if (t.includes("alternative")) return "alternatives";
  if (t.includes("review")) return "reviews";
  if (t.includes("price") || t.includes("cost")) return "pricing";
  if (t.includes("near me") || t.includes(" in ")) return "local";
  if (t.startsWith("best") || t.startsWith("top")) return "best_of";
  if (t.startsWith("how") || t.startsWith("what")) return "problem_aware";
  if (t.includes("sign up") || t.includes("buy") || t.includes("book")) return "transactional";
  return "solution_aware";
}

function dedupePrompts(rows: Omit<Prompt, "id" | "created_at">[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
