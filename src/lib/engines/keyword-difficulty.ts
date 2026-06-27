/**
 * Real keyword difficulty — reverse-engineered from how Ahrefs/Semrush compute
 * KD, made keyless. Their KD is a function of how strong the pages that already
 * rank are (referring domains / authority of the top results). We approximate
 * that with the **Tranco authority of the domains actually ranking** for the
 * keyword (plus SERP features), instead of a position-only heuristic.
 *
 * Fully keyless: a SERP provider (Serper/Brave/OmniData scrape) + the keyless
 * Tranco authority list. Difficulty is labeled `ranking_authority` so the UI can
 * distinguish it from the old heuristic.
 */
import { searchGoogleOrganicRouter, getActiveSerpProvider } from "@/lib/providers/serp-router";
import { resolveDomainAuthority } from "@/lib/providers/domain-authority";

export interface KeywordDifficultyRow {
  keyword: string;
  difficulty: number;
  difficulty_method: "ranking_authority" | "heuristic";
  intent: string;
  our_position: number | null;
  opportunity_score: number;
  top_domains: string[];
  has_ai_overview: boolean;
}

export function hasKeylessDifficulty(): boolean {
  return getActiveSerpProvider() !== null;
}

function classifyIntent(keyword: string): string {
  const k = keyword.toLowerCase();
  if (/\b(near me|in [a-z]+|local)\b/.test(k)) return "local";
  if (/\b(buy|price|cost|quote|hire|book|order|pricing)\b/.test(k)) return "transactional";
  if (/\b(best|top|vs|compare|comparison|review|alternative)\b/.test(k)) return "commercial";
  return "informational";
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

/**
 * Difficulty for ONE keyword from the authority of its top-ranking domains.
 * Returns null when no SERP could be fetched (so the caller can fall back).
 */
export async function scoreKeywordKeyless(
  keyword: string,
  brandDomain: string,
  location = "United States"
): Promise<KeywordDifficultyRow | null> {
  const brand = cleanDomain(brandDomain);
  const serp = await searchGoogleOrganicRouter(keyword, location, brand, []);
  if (!serp.success || !serp.data) return null;

  const organic = [...serp.data.organicResults].sort((a, b) => a.position - b.position).slice(0, 10);
  if (organic.length === 0) return null;

  const domains = [...new Set(organic.map((r) => hostname(r.url)).filter(Boolean))];
  const authResults = await Promise.all(
    domains.map((d) => resolveDomainAuthority(d).catch(() => null))
  );
  // Only count domains whose authority we could actually RESOLVE. Counting an
  // unresolved domain as authority 0 (the old behavior) drags avgAuth down and
  // makes a strong SERP look artificially easy — a false "low difficulty".
  const resolved = authResults.filter(
    (r): r is NonNullable<typeof r> => Boolean(r) && r!.source !== "unlisted"
  );
  const authScores = resolved.map((r) => r.score);

  const avgAuth = authScores.length
    ? authScores.reduce((a, b) => a + b, 0) / authScores.length
    : 0;
  const highCount = authScores.filter((s) => s >= 70).length;
  // Coverage = how much of the SERP we could authority-resolve. Low coverage
  // means the difficulty is a weaker estimate (surfaced via difficulty_method).
  const coverage = domains.length ? resolved.length / domains.length : 0;
  const hasAi = Boolean(serp.data.aiOverview?.present);

  // KD is dominated by how authoritative the ranking pages are; a SERP stacked
  // with high-authority domains is genuinely harder to break into.
  const difficulty = Math.max(
    1,
    Math.min(100, Math.round(avgAuth * 0.85 + highCount * 3 + (hasAi ? 6 : 0)))
  );

  // Our position, if the brand appears.
  const ours = organic.find((r) => {
    const h = hostname(r.url);
    return h === brand || h.endsWith(`.${brand}`);
  });
  const our_position = ours ? ours.position : null;

  // Opportunity: easier keywords, striking-distance positions, and gaps win.
  const lowDiffBonus = Math.max(0, 60 - difficulty);
  const strikingBonus = our_position && our_position >= 4 && our_position <= 20 ? 25 : 0;
  const notRankingBonus = our_position ? 0 : 15;
  const opportunity_score = Math.min(
    100,
    lowDiffBonus + strikingBonus + notRankingBonus + (hasAi ? 10 : 0)
  );

  return {
    keyword,
    difficulty,
    // Only claim the strong "ranking_authority" method when we resolved authority
    // for a majority of the SERP; otherwise it's a weaker estimate.
    difficulty_method: coverage >= 0.5 && authScores.length >= 3 ? "ranking_authority" : "heuristic",
    intent: classifyIntent(keyword),
    our_position,
    opportunity_score,
    top_domains: domains,
    has_ai_overview: hasAi,
  };
}

/**
 * Score many keywords keylessly, in small parallel batches to respect SERP
 * provider rate limits. Caps the keyword count to bound network usage.
 */
export async function scoreKeywordsKeyless(
  brandDomain: string,
  keywords: string[],
  opts: { location?: string; max?: number; batchSize?: number } = {}
): Promise<KeywordDifficultyRow[]> {
  if (!hasKeylessDifficulty()) return [];
  const max = opts.max ?? 12;
  const batchSize = opts.batchSize ?? 4;
  const list = [...new Set(keywords)].filter(Boolean).slice(0, max);
  const out: KeywordDifficultyRow[] = [];

  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const rows = await Promise.all(
      batch.map((kw) => scoreKeywordKeyless(kw, brandDomain, opts.location).catch(() => null))
    );
    for (const r of rows) if (r) out.push(r);
  }

  return out.sort((a, b) => b.opportunity_score - a.opportunity_score);
}
