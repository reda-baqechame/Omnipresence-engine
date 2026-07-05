import { z } from "zod";
import { generateStructured } from "@/lib/providers/ai-gateway";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { preferLiveData } from "@/lib/config/capabilities";

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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Live SERP clustering: group keywords by shared ranking domains (Jaccard on top-10). */
export async function clusterKeywordsByLiveSerp(
  keywords: string[],
  domain?: string,
  maxKeywords = 30
): Promise<Array<{ hub: string; keywords: string[]; overlapScore: number }>> {
  if (!preferLiveData()) return [];
  const list = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, maxKeywords);
  const serpDomains = new Map<string, Set<string>>();

  for (const kw of list) {
    const res = await searchGoogleOrganicRouter(kw, "United States", domain || "", []);
    if (!res.success || !res.data?.organicResults?.length) continue;
    const hosts = new Set(
      res.data.organicResults
        .slice(0, 10)
        .map((r) => hostnameOf(r.url))
        .filter(Boolean)
    );
    if (hosts.size) serpDomains.set(kw.toLowerCase(), hosts);
  }

  const entries = [...serpDomains.entries()];
  const clusters: Array<{ hub: string; keywords: string[]; overlapScore: number }> = [];
  const assigned = new Set<string>();

  for (const [kw, hosts] of entries) {
    if (assigned.has(kw)) continue;
    const group = [kw];
    assigned.add(kw);
    let overlapSum = 0;
    let overlapCount = 0;

    for (const [other, otherHosts] of entries) {
      if (assigned.has(other)) continue;
      const score = jaccard(hosts, otherHosts);
      if (score >= 0.35) {
        group.push(other);
        assigned.add(other);
        overlapSum += score;
        overlapCount += 1;
      }
    }

    clusters.push({
      hub: kw,
      keywords: group,
      overlapScore: overlapCount ? Math.round((overlapSum / overlapCount) * 100) : 0,
    });
  }

  return clusters.sort((a, b) => b.keywords.length - a.keywords.length).slice(0, 12);
}

export async function buildTopicalMap(input: {
  brand: string;
  industry?: string;
  keywords: string[];
  domain?: string;
}): Promise<{ available: boolean; reason?: string; map?: TopicalMap; clustering?: string }> {
  const liveClusters = await clusterKeywordsByLiveSerp(input.keywords, input.domain, 30);
  const tokenClusters = clusterKeywordsBySerpOverlap(input.keywords.slice(0, 80));
  const clustered = liveClusters.length ? liveClusters : tokenClusters;

  const kw = clustered.length
    ? clustered
        .map((c) =>
          "overlapScore" in c && c.overlapScore
            ? `${c.hub} (SERP overlap ${c.overlapScore}%): ${c.keywords.join(", ")}`
            : `${c.hub}: ${c.keywords.join(", ")}`
        )
        .join("\n")
    : input.keywords.slice(0, 120).join(", ");

  const clustering =
    liveClusters.length > 0 ? "measured_serp_overlap" : tokenClusters.length ? "token_fallback" : "none";

  const res = await generateStructured(
    "You are an SEO content strategist who builds hub-and-spoke topical maps that establish topical authority. Group keywords into pillars (hubs) and supporting articles (spokes), each labeled with search intent, buyer stage, and the page type a specialist would build.",
    `Brand: ${input.brand}\nIndustry: ${input.industry || "n/a"}\nKeyword clusters (measured SERP overlap when noted):\n${kw || "(derive from industry)"}\n\nBuild a hub-and-spoke topical map (3-6 hubs, each with 3-8 spokes).`,
    TopicalMapSchema
  );
  if (!res.success || !res.data) return { available: false, reason: res.error || "AI unavailable", clustering };
  return { available: true, map: res.data, clustering };
}

/** Token fallback when SERP unavailable — groups keywords sharing token roots. */
export function clusterKeywordsBySerpOverlap(keywords: string[]): Array<{ hub: string; keywords: string[] }> {
  const groups = new Map<string, Set<string>>();
  for (const kw of keywords) {
    const tokens = kw.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    const hub = tokens.slice(0, 2).join(" ") || kw.slice(0, 24);
    const set = groups.get(hub) || new Set<string>();
    set.add(kw);
    groups.set(hub, set);
  }
  return [...groups.entries()]
    .map(([hub, set]) => ({ hub, keywords: [...set] }))
    .sort((a, b) => b.keywords.length - a.keywords.length)
    .slice(0, 12);
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
