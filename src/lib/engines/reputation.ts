import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { fetchLiveCommunityMentions } from "@/lib/engines/community-mentions";
import { generateStructured } from "@/lib/providers/ai-gateway";

/**
 * Brand & reputation monitoring (Phase 14). Aggregates web + community mentions
 * with AI sentiment, flags unlinked mentions, runs an AI brand-sentiment
 * correction workflow (what AI engines say about the brand + how to fix it), and
 * audits the brand SERP for owned-profile gaps (knowledge-panel control).
 */

type Sentiment = "positive" | "neutral" | "negative" | "unknown";

export interface BrandMention {
  platform: string;
  url: string;
  title?: string;
  sentiment: Sentiment;
  sentiment_score?: number;
  is_unlinked: boolean;
  mention_type: string;
}

const SentimentSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      sentiment: z.enum(["positive", "neutral", "negative"]),
      score: z.number().min(-1).max(1),
    })
  ),
});

async function scoreSentiments(
  items: { title?: string; url: string }[]
): Promise<Map<number, { sentiment: Sentiment; score: number }>> {
  const map = new Map<number, { sentiment: Sentiment; score: number }>();
  if (items.length === 0) return map;
  const list = items.map((it, i) => `${i}. ${it.title || it.url}`).join("\n");
  const res = await generateStructured(
    "You classify the sentiment of brand mentions toward the brand. Return sentiment and a score from -1 (very negative) to 1 (very positive) for each numbered item.",
    `Classify the sentiment of these brand mentions:\n${list}`,
    SentimentSchema
  );
  if (res.success && res.data) {
    for (const r of res.data.results) map.set(r.index, { sentiment: r.sentiment, score: r.score });
  }
  return map;
}

export async function monitorBrandMentions(
  supabase: SupabaseClient,
  input: { projectId: string; brand: string; domain: string; competitors?: string[] }
): Promise<{ available: boolean; reason?: string; mentions: BrandMention[]; summary: { total: number; negative: number; unlinked: number } }> {
  const clean = input.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const collected: { platform: string; url: string; title?: string }[] = [];

  // Web mentions (excluding the brand's own site).
  const web = await searchGoogleOrganicRouter(`"${input.brand}" -site:${clean}`, "United States", clean, []);
  if (web.success && web.data) {
    for (const r of web.data.organicResults.slice(0, 15)) {
      collected.push({ platform: "web", url: r.url, title: r.title });
    }
  }

  // Community mentions (Reddit/Quora/HN).
  const community = await fetchLiveCommunityMentions(input.brand, input.competitors || []);
  for (const m of community.rows.slice(0, 20)) {
    collected.push({ platform: m.platform, url: m.url, title: m.title });
  }

  if (collected.length === 0) {
    return {
      available: false,
      reason: "No mentions found (configure a SERP provider / Reddit API).",
      mentions: [],
      summary: { total: 0, negative: 0, unlinked: 0 },
    };
  }

  // Dedup by url.
  const seen = new Set<string>();
  const unique = collected.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  const sentiments = await scoreSentiments(unique);

  const mentions: BrandMention[] = unique.map((c, i) => {
    const s = sentiments.get(i);
    // A web mention is "unlinked" unless the page is on the brand's own domain.
    let host = "";
    try {
      host = new URL(c.url).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    return {
      platform: c.platform,
      url: c.url,
      title: c.title,
      sentiment: s?.sentiment ?? "unknown",
      sentiment_score: s?.score,
      is_unlinked: !host.includes(clean),
      mention_type: "brand",
    };
  });

  // Persist (best-effort upsert).
  await supabase.from("brand_mentions").upsert(
    mentions.map((m) => ({
      project_id: input.projectId,
      platform: m.platform,
      url: m.url,
      title: m.title,
      sentiment: m.sentiment,
      sentiment_score: m.sentiment_score,
      is_unlinked: m.is_unlinked,
      mention_type: m.mention_type,
    })),
    { onConflict: "project_id,url" }
  );

  return {
    available: true,
    mentions,
    summary: {
      total: mentions.length,
      negative: mentions.filter((m) => m.sentiment === "negative").length,
      unlinked: mentions.filter((m) => m.is_unlinked).length,
    },
  };
}

// ---------- AI brand-sentiment correction ----------

const AiSentimentSchema = z.object({
  overall_sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  summary: z.string(),
  issues: z.array(
    z.object({
      claim: z.string().describe("A negative or potentially-incorrect claim an AI might make"),
      likely_source: z.string().describe("Where this perception likely comes from"),
      correction: z.string().describe("Factual correction or positioning"),
      fix_asset: z.string().describe("A page/FAQ/asset to publish to correct it"),
    })
  ),
});

export async function analyzeAiBrandSentiment(input: {
  brand: string;
  domain: string;
  industry?: string;
}): Promise<{ available: boolean; reason?: string; result?: z.infer<typeof AiSentimentSchema> }> {
  const res = await generateStructured(
    "You analyze how AI assistants likely portray a brand based on public information, identifying negative or incorrect claims and concrete corrections. Be honest and specific; do not invent praise.",
    `Brand: ${input.brand} (${input.domain})\nIndustry: ${input.industry || "n/a"}\n\nAssess how AI engines likely describe this brand, list the negative/incorrect claims that could surface, their likely sources, and the correction asset to publish for each.`,
    AiSentimentSchema
  );
  if (!res.success || !res.data) return { available: false, reason: res.error || "AI unavailable" };
  return { available: true, result: res.data };
}

// ---------- Brand SERP / knowledge-panel control ----------

export interface BrandSerpAudit {
  available: boolean;
  reason?: string;
  ownedCount: number;
  thirdPartyCount: number;
  results: { position: number; url: string; title: string; owned: boolean }[];
  missingProfiles: string[];
}

const EXPECTED_PROFILES = [
  { name: "LinkedIn", hint: "linkedin.com" },
  { name: "Crunchbase", hint: "crunchbase.com" },
  { name: "Wikipedia", hint: "wikipedia.org" },
  { name: "G2", hint: "g2.com" },
  { name: "Trustpilot", hint: "trustpilot.com" },
  { name: "X (Twitter)", hint: "twitter.com" },
];

export async function auditBrandSerp(
  brand: string,
  domain: string
): Promise<BrandSerpAudit> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const res = await searchGoogleOrganicRouter(brand, "United States", clean, []);
  if (!res.success || !res.data) {
    return { available: false, reason: res.error || "No SERP provider configured.", ownedCount: 0, thirdPartyCount: 0, results: [], missingProfiles: [] };
  }

  const top = res.data.organicResults.slice(0, 10);
  const results = top.map((r) => {
    let host = "";
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    return { position: r.position, url: r.url, title: r.title, owned: host.includes(clean) };
  });

  const blob = top.map((r) => r.url.toLowerCase()).join(" ");
  const missingProfiles = EXPECTED_PROFILES.filter((p) => !blob.includes(p.hint)).map((p) => p.name);

  return {
    available: true,
    ownedCount: results.filter((r) => r.owned).length,
    thirdPartyCount: results.filter((r) => !r.owned).length,
    results,
    missingProfiles,
  };
}
