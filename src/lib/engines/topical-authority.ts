import { z } from "zod";
import { generateStructured } from "@/lib/providers/ai-gateway";

/**
 * Topical authority & content architecture (Phase 15). Turns the keyword
 * universe into a hub-and-spoke topical map with intent + buyer stage and a
 * recommended page type per node - the way a specialist plans a site, not random
 * posts. Also generates SERP-informed content briefs.
 */

const TopicalMapSchema = z.object({
  hubs: z
    .array(
      z.object({
        hub: z.string().describe("Pillar/hub topic name"),
        intent: z.enum(["informational", "commercial", "transactional", "navigational"]),
        page_type: z.string().describe("e.g. pillar guide, category page, comparison hub"),
        spokes: z
          .array(
            z.object({
              title: z.string(),
              keyword: z.string(),
              intent: z.enum(["informational", "commercial", "transactional", "navigational"]),
              buyer_stage: z.enum(["awareness", "consideration", "decision"]),
              page_type: z.string(),
            })
          )
          .describe("3-8 supporting spoke articles per hub"),
      })
    )
    .describe("3-6 hubs covering the topic space"),
});

export type TopicalMap = z.infer<typeof TopicalMapSchema>;

export async function buildTopicalMap(input: {
  brand: string;
  industry?: string;
  keywords: string[];
}): Promise<{ available: boolean; reason?: string; map?: TopicalMap }> {
  const kw = input.keywords.slice(0, 120).join(", ");
  const res = await generateStructured(
    "You are an SEO content strategist who builds hub-and-spoke topical maps that establish topical authority. Group keywords into pillars (hubs) and supporting articles (spokes), each labeled with search intent, buyer stage, and the page type a specialist would build.",
    `Brand: ${input.brand}\nIndustry: ${input.industry || "n/a"}\nKeyword universe: ${kw || "(derive from industry)"}\n\nBuild a hub-and-spoke topical map (3-6 hubs, each with 3-8 spokes).`,
    TopicalMapSchema
  );
  if (!res.success || !res.data) return { available: false, reason: res.error || "AI unavailable" };
  return { available: true, map: res.data };
}

const BriefSchema = z.object({
  title: z.string(),
  target_keyword: z.string(),
  search_intent: z.string(),
  word_count: z.number(),
  outline: z.array(z.object({ heading: z.string(), points: z.array(z.string()) })),
  must_cover_entities: z.array(z.string()),
  faqs: z.array(z.string()),
  internal_link_targets: z.array(z.string()),
});

export type ContentBrief = z.infer<typeof BriefSchema>;

export async function generateContentBrief(input: {
  keyword: string;
  brand: string;
  serpWinners?: string[];
}): Promise<{ available: boolean; reason?: string; brief?: ContentBrief }> {
  const winners = (input.serpWinners || []).slice(0, 10).join("\n");
  const res = await generateStructured(
    "You write actionable SEO content briefs informed by what currently ranks. Briefs are specific: heading outline, entities to cover, FAQs, and internal-link targets.",
    `Keyword: ${input.keyword}\nBrand: ${input.brand}\nCurrent SERP winners (titles/URLs):\n${winners || "(none provided)"}\n\nProduce a complete content brief to outrank these.`,
    BriefSchema
  );
  if (!res.success || !res.data) return { available: false, reason: res.error || "AI unavailable" };
  return { available: true, brief: res.data };
}
