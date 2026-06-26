import { runSerpLive, findDomainPosition } from "./serp.js";

const OPR_KEY = process.env.OPENPAGERANK_API_KEY;

// Fallback authority set used only when OpenPageRank is not configured.
const AUTHORITY_DOMAINS = new Set([
  "wikipedia.org",
  "youtube.com",
  "amazon.com",
  "reddit.com",
  "linkedin.com",
  "forbes.com",
  "nytimes.com",
]);

function classifyIntent(keyword: string): "informational" | "commercial" | "transactional" | "local" {
  const k = keyword.toLowerCase();
  if (/\b(near me|in [a-z]+|local)\b/.test(k)) return "local";
  if (/\b(buy|price|cost|quote|hire|book|order)\b/.test(k)) return "transactional";
  if (/\b(best|top|vs|compare|review|alternative)\b/.test(k)) return "commercial";
  return "informational";
}

/** Batch real domain ratings (0-100) from OpenPageRank (<=100 domains/call). */
async function fetchAuthorityBatch(domains: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!OPR_KEY || domains.length === 0) return out;
  try {
    const params = domains.slice(0, 100).map((d) => `domains[]=${encodeURIComponent(d)}`).join("&");
    const res = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?${params}`, {
      headers: { "API-OPR": OPR_KEY },
    });
    if (!res.ok) return out;
    const data = (await res.json()) as {
      response?: Array<{ domain: string; page_rank_integer?: number }>;
    };
    for (const r of data.response || []) {
      if (typeof r.page_rank_integer === "number") out.set(r.domain, Math.round(r.page_rank_integer * 10));
    }
  } catch {
    /* degrade to heuristic */
  }
  return out;
}

export interface DifficultyInputs {
  domains: string[];
  serpFeatureTypes: string[];
  /** Real 0-100 domain ratings keyed by domain (OpenPageRank); empty = heuristic. */
  authorityMap: Map<string, number>;
}

/**
 * Pure difficulty computation (testable). When real authority ratings are
 * present, KD is driven by the authority of the ranking domains (Ahrefs-style);
 * otherwise it falls back to domain diversity + a small known-authority list.
 */
export function computeDifficulty(input: DifficultyInputs): {
  difficulty: number;
  method: "ranking_authority" | "heuristic";
} {
  const uniqueDomains = [...new Set(input.domains)];
  const hasAi = input.serpFeatureTypes.includes("ai_overview");
  const featureScore = input.serpFeatureTypes.includes("featured_snippet") ? 8 : 0;

  if (input.authorityMap.size > 0) {
    const scores = uniqueDomains.map((d) => input.authorityMap.get(d) ?? 0);
    const avgAuth = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const highCount = scores.filter((s) => s >= 70).length;
    const difficulty = Math.max(
      1,
      Math.min(100, Math.round(avgAuth * 0.85 + highCount * 3 + (hasAi ? 6 : 0) + featureScore))
    );
    return { difficulty, method: "ranking_authority" };
  }

  const authorityHits = uniqueDomains.filter((d) =>
    [...AUTHORITY_DOMAINS].some((a) => d === a || d.endsWith(`.${a}`))
  ).length;
  const diversityScore = Math.min(uniqueDomains.length * 8, 40);
  const authorityScore = Math.min(authorityHits * 12, 48);
  const difficulty = Math.min(100, diversityScore + authorityScore + featureScore + (hasAi ? 6 : 0));
  return { difficulty, method: "heuristic" };
}

/** SERP competition score 0–100 from the authority of the domains actually ranking. */
export async function estimateKeywordDifficulty(keyword: string): Promise<{
  keyword: string;
  difficulty: number;
  difficulty_method: "ranking_authority" | "heuristic";
  intent: ReturnType<typeof classifyIntent>;
  top_domains: string[];
  serp_features: string[];
  has_ai_overview: boolean;
}> {
  const serp = await runSerpLive(keyword);
  const items = serp.tasks[0]?.result?.[0]?.items || [];
  const organic = items.filter((i) => i.type === "organic").slice(0, 10);
  const domains = organic
    .map((i) => (i.domain || "").replace(/^www\./, "").toLowerCase())
    .filter(Boolean);
  const uniqueDomains = [...new Set(domains)];

  const features = items
    .filter((i) => i.type !== "organic")
    .map((i) => i.type)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);

  const authorityMap = await fetchAuthorityBatch(uniqueDomains);
  const { difficulty, method } = computeDifficulty({
    domains: uniqueDomains,
    serpFeatureTypes: features,
    authorityMap,
  });

  return {
    keyword,
    difficulty,
    difficulty_method: method,
    intent: classifyIntent(keyword),
    top_domains: uniqueDomains,
    serp_features: features,
    has_ai_overview: features.includes("ai_overview"),
  };
}

export async function scoreKeywordsForDomain(
  keywords: string[],
  domain: string
): Promise<
  Array<{
    keyword: string;
    difficulty: number;
    difficulty_method: "ranking_authority" | "heuristic";
    intent: string;
    our_position: number | null;
    opportunity_score: number;
  }>
> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const results = [];

  for (const keyword of keywords.slice(0, 15)) {
    const [diff, serp] = await Promise.all([
      estimateKeywordDifficulty(keyword),
      runSerpLive(keyword),
    ]);
    const items = serp.tasks[0]?.result?.[0]?.items || [];
    const pos = findDomainPosition(items, clean);

    const strikingBonus = pos.position && pos.position >= 4 && pos.position <= 20 ? 25 : 0;
    const notRankingBonus = pos.position ? 0 : 15;
    const lowDiffBonus = Math.max(0, 60 - diff.difficulty);
    const opportunity_score = Math.min(
      100,
      lowDiffBonus + strikingBonus + notRankingBonus + (diff.has_ai_overview ? 10 : 0)
    );

    results.push({
      keyword,
      difficulty: diff.difficulty,
      difficulty_method: diff.difficulty_method,
      intent: diff.intent,
      our_position: pos.position,
      opportunity_score,
    });
  }

  return results.sort((a, b) => b.opportunity_score - a.opportunity_score);
}
