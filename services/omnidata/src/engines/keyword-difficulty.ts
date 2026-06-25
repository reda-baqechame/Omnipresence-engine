import { runSerpLive, findDomainPosition } from "./serp.js";

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

/** SERP competition score 0–100 from top-10 domain diversity and authority signals. */
export async function estimateKeywordDifficulty(keyword: string): Promise<{
  keyword: string;
  difficulty: number;
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

  const uniqueDomains = new Set(domains);
  const authorityHits = domains.filter((d) =>
    [...AUTHORITY_DOMAINS].some((a) => d === a || d.endsWith(`.${a}`))
  ).length;

  const diversityScore = Math.min(uniqueDomains.size * 8, 40);
  const authorityScore = Math.min(authorityHits * 12, 48);
  const featureScore = items.some((i) => i.type === "featured_snippet") ? 8 : 0;
  const aiScore = items.some((i) => i.type === "ai_overview") ? 6 : 0;
  const difficulty = Math.min(100, diversityScore + authorityScore + featureScore + aiScore);

  const features = items
    .filter((i) => i.type !== "organic")
    .map((i) => i.type)
    .filter((v, idx, arr) => arr.indexOf(v) === idx);

  return {
    keyword,
    difficulty,
    intent: classifyIntent(keyword),
    top_domains: [...uniqueDomains],
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
      intent: diff.intent,
      our_position: pos.position,
      opportunity_score,
    });
  }

  return results.sort((a, b) => b.opportunity_score - a.opportunity_score);
}
