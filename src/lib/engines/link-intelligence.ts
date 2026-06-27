import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { generateStructured } from "@/lib/providers/ai-gateway";

/**
 * Link & authority intelligence (Phase 13). Extends the backlink monitor with
 * authority distribution, competitor backlink-gap (using confirmed competitor
 * domains), digital-PR asset ideation, unlinked-mention reclamation, and a
 * HARO-style expert-quote workflow. Measured where possible; AI is used only
 * for ideation/drafting, clearly separated from measured link data.
 */

// ---------- Authority distribution ----------

export interface AuthorityDistribution {
  buckets: { label: string; min: number; max: number; count: number }[];
  total: number;
  median: number | null;
}

export function analyzeAuthorityDistribution(rows: { rank: number }[]): AuthorityDistribution {
  const buckets = [
    { label: "Very high (80-100)", min: 80, max: 100, count: 0 },
    { label: "High (60-79)", min: 60, max: 79, count: 0 },
    { label: "Medium (40-59)", min: 40, max: 59, count: 0 },
    { label: "Low (20-39)", min: 20, max: 39, count: 0 },
    { label: "Very low (0-19)", min: 0, max: 19, count: 0 },
  ];
  for (const r of rows) {
    const b = buckets.find((bk) => r.rank >= bk.min && r.rank <= bk.max);
    if (b) b.count += 1;
  }
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const median = ranks.length ? ranks[Math.floor(ranks.length / 2)] : null;
  return { buckets, total: rows.length, median };
}

// ---------- Competitor backlink gap ----------

export type LinkGapType = "directory" | "listicle" | "resource" | "podcast" | "guest" | "pr" | "other";

export interface LinkGap {
  domain: string;
  linksToCompetitors: string[];
  count: number;
  type: LinkGapType;
}

const DIRECTORY_HINTS = ["g2.com", "capterra", "crunchbase", "producthunt", "getapp", "trustpilot", "softwareadvice"];
const PODCAST_HINTS = ["podcast", "buzzsprout", "transistor", "spotify", "apple.com/podcast"];
const RESOURCE_HINTS = ["resources", "/blog/", "guide", "awesome-"];

function classifyLinkType(domain: string): LinkGapType {
  const d = domain.toLowerCase();
  if (DIRECTORY_HINTS.some((h) => d.includes(h))) return "directory";
  if (PODCAST_HINTS.some((h) => d.includes(h))) return "podcast";
  if (d.includes("best") || d.includes("top") || d.includes("review") || d.includes("alternative")) return "listicle";
  if (RESOURCE_HINTS.some((h) => d.includes(h))) return "resource";
  return "other";
}

export async function findCompetitorBacklinkGap(
  supabase: SupabaseClient,
  projectId: string,
  brandDomain: string
): Promise<{ available: boolean; reason?: string; gaps: LinkGap[] }> {
  const { data: competitors } = await supabase
    .from("competitors")
    .select("domain")
    .eq("project_id", projectId)
    .not("domain", "is", null);

  const compDomains = Array.from(
    new Set((competitors || []).map((c) => (c.domain || "").replace(/^www\./, "").toLowerCase()).filter(Boolean))
  );

  if (compDomains.length === 0) {
    return { available: false, reason: "No confirmed competitor domains yet. Run a scan to resolve competitors.", gaps: [] };
  }

  const brandLinks = await getBacklinksFree(brandDomain, 100);
  const brandRefDomains = new Set(
    (brandLinks.success ? brandLinks.data || [] : []).map((b) => b.domain.toLowerCase())
  );

  const linkers = new Map<string, Set<string>>();
  for (const comp of compDomains.slice(0, 5)) {
    const res = await getBacklinksFree(comp, 100);
    if (!res.success || !res.data) continue;
    for (const link of res.data) {
      const d = link.domain.toLowerCase();
      if (!d || brandRefDomains.has(d) || d.includes(brandDomain.toLowerCase())) continue;
      const set = linkers.get(d) || new Set<string>();
      set.add(comp);
      linkers.set(d, set);
    }
  }

  const gaps: LinkGap[] = Array.from(linkers.entries())
    .map(([domain, comps]) => ({
      domain,
      linksToCompetitors: Array.from(comps),
      count: comps.size,
      type: classifyLinkType(domain),
    }))
    .sort((a, b) => b.count - a.count);

  return { available: true, gaps };
}

// ---------- Digital PR asset ideation ----------

const PrAssetsSchema = z.object({
  assets: z
    .array(
      z.object({
        type: z.string().describe("statistic page | calculator | index/ranking | survey report | tool"),
        title: z.string(),
        description: z.string(),
        why_linkable: z.string(),
        pitch_angle: z.string(),
      })
    )
    .describe("4-6 linkable data-asset ideas"),
});

export async function generateDigitalPrAssets(input: {
  brand: string;
  industry?: string;
  audience?: string;
}): Promise<{ available: boolean; reason?: string; assets?: z.infer<typeof PrAssetsSchema>["assets"] }> {
  const res = await generateStructured(
    "You are a digital-PR strategist who designs genuinely linkable data assets (original statistics, calculators, indexes, survey reports) that journalists and bloggers naturally cite. Be specific and realistic.",
    `Brand: ${input.brand}\nIndustry: ${input.industry || "n/a"}\nAudience: ${input.audience || "n/a"}\n\nPropose 4-6 linkable data-asset ideas with a concrete pitch angle for each.`,
    PrAssetsSchema
  );
  if (!res.success || !res.data) return { available: false, reason: res.error || "AI unavailable" };
  return { available: true, assets: res.data.assets };
}

// ---------- Unlinked mention reclamation ----------

export interface UnlinkedMention {
  url: string;
  title: string;
  domain: string;
}

export async function findUnlinkedMentions(
  brand: string,
  domain: string
): Promise<{ available: boolean; reason?: string; candidates: UnlinkedMention[] }> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const res = await searchGoogleOrganicRouter(`"${brand}" -site:${clean}`, "United States", clean, []);
  if (!res.success || !res.data) {
    return { available: false, reason: res.error || "No SERP provider configured.", candidates: [] };
  }
  const candidates: UnlinkedMention[] = [];
  const seen = new Set<string>();
  for (const r of res.data.organicResults) {
    let host = "";
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!host || host.includes(clean) || seen.has(host)) continue;
    seen.add(host);
    candidates.push({ url: r.url, title: r.title, domain: host });
  }
  return { available: true, candidates };
}

// ---------- HARO / expert-quote workflow ----------

const ExpertQuotesSchema = z.object({
  quotes: z
    .array(z.object({ topic: z.string(), quote: z.string(), credibility_hook: z.string() }))
    .describe("3-5 ready-to-submit expert quotes"),
});

export const HARO_PLATFORMS = [
  { name: "Connectively (HARO)", url: "https://www.connectively.us" },
  { name: "Qwoted", url: "https://www.qwoted.com" },
  { name: "Featured (Terkel)", url: "https://featured.com" },
  { name: "SourceBottle", url: "https://www.sourcebottle.com" },
  { name: "Help a B2B Writer", url: "https://helpab2bwriter.com" },
];

export async function generateExpertQuotes(input: {
  brand: string;
  expertName?: string;
  industry?: string;
  topics?: string[];
}): Promise<{ available: boolean; reason?: string; quotes?: z.infer<typeof ExpertQuotesSchema>["quotes"]; platforms: typeof HARO_PLATFORMS }> {
  const res = await generateStructured(
    "You draft concise, genuinely useful expert quotes for journalist requests (HARO-style). Quotes are specific, non-promotional, and demonstrate real expertise.",
    `Brand/expert: ${input.expertName || input.brand}\nIndustry: ${input.industry || "n/a"}\nTopics: ${(input.topics || []).join(", ") || "general industry"}\n\nWrite 3-5 ready-to-submit expert quotes with a credibility hook for each.`,
    ExpertQuotesSchema
  );
  if (!res.success || !res.data) {
    return { available: false, reason: res.error || "AI unavailable", platforms: HARO_PLATFORMS };
  }
  return { available: true, quotes: res.data.quotes, platforms: HARO_PLATFORMS };
}
