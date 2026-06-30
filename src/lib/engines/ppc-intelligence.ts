/**
 * PPC / paid-replacement intelligence.
 *
 * Two honest deliverables on top of the sovereign SERP + Keyword Planner stack:
 *   1. Competitor ad snapshots — WHO is buying ads on your money keywords, their
 *      ad copy and landing pages, captured live from the SERP paid block.
 *   2. CPC / CAC savings — the organic+AI value replacing paid spend, using the
 *      REAL Google Ads Keyword Planner CPC when available (label `real`) and an
 *      industry default otherwise (label `industry_estimate`). Never claims a real
 *      CPC we didn't measure.
 */
import { getSerpIntelligence, getRealKeywordCpc } from "@/lib/providers/dataforseo";
import { calculateAdsEquivalent, type AdsEquivalentResult } from "@/lib/engines/ads-equivalent";

export interface CompetitorAd {
  advertiserDomain: string;
  title: string;
  url: string;
  /** Keywords (from the scanned set) this advertiser showed ads on. */
  keywords: string[];
  appearances: number;
}

export interface CompetitorAdSnapshot {
  available: boolean;
  reason?: string;
  keywordsScanned: number;
  keywordsWithAds: number;
  advertisers: CompetitorAd[];
  provider?: string;
}

/**
 * Capture the live paid block for a set of money keywords and roll it up by
 * advertiser. Honest: returns available=false when no SERP backend is configured,
 * and simply reports zero advertisers when the SERPs carried no ads (never faked).
 */
export async function captureCompetitorAds(
  keywords: string[],
  location = "United States",
  device: "desktop" | "mobile" = "desktop"
): Promise<CompetitorAdSnapshot> {
  const clean = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 15);
  if (clean.length === 0) {
    return { available: false, reason: "No keywords supplied to scan for ads.", keywordsScanned: 0, keywordsWithAds: 0, advertisers: [] };
  }

  const byAdvertiser = new Map<string, CompetitorAd>();
  let keywordsWithAds = 0;
  let scanned = 0;
  let provider: string | undefined;
  let anyBackend = false;

  for (const keyword of clean) {
    const serp = await getSerpIntelligence(keyword, location, device);
    if (!serp) continue; // backend unavailable for this query
    anyBackend = true;
    scanned++;
    provider = serp.provider;
    if (serp.ads.length > 0) keywordsWithAds++;
    for (const ad of serp.ads) {
      const key = ad.domain || ad.url;
      if (!key) continue;
      const existing = byAdvertiser.get(key);
      if (existing) {
        existing.appearances++;
        if (!existing.keywords.includes(keyword)) existing.keywords.push(keyword);
      } else {
        byAdvertiser.set(key, {
          advertiserDomain: ad.domain || key,
          title: ad.title,
          url: ad.url,
          keywords: [keyword],
          appearances: 1,
        });
      }
    }
  }

  if (!anyBackend) {
    return {
      available: false,
      reason: "SERP ads need the sovereign OmniData SERP backend (set OMNIDATA_BASE_URL) or DataForSEO.",
      keywordsScanned: 0,
      keywordsWithAds: 0,
      advertisers: [],
    };
  }

  const advertisers = [...byAdvertiser.values()].sort((a, b) => b.appearances - a.appearances);
  return { available: true, keywordsScanned: scanned, keywordsWithAds, advertisers, provider };
}

export interface PpcSavings extends AdsEquivalentResult {
  /** Estimated cost to acquire the same sessions via paid search. */
  estimatedPaidCost: number;
  keywordsPriced: number;
}

/**
 * CPC/CAC savings: value of organic + AI sessions vs. what they'd cost as paid
 * search. Uses the REAL Keyword Planner CPC for the supplied keywords when
 * available; otherwise an industry default (honestly labeled via `cpcSource`).
 */
export async function estimatePpcSavings(opts: {
  organicSessions: number;
  aiReferralSessions: number;
  monthlyAdSpend?: number;
  industry?: string;
  keywords?: string[];
}): Promise<PpcSavings> {
  const keywords = opts.keywords || [];
  const realCpc = keywords.length ? await getRealKeywordCpc(keywords) : null;

  const base = calculateAdsEquivalent({
    organicSessions: opts.organicSessions,
    aiReferralSessions: opts.aiReferralSessions,
    monthlyAdSpend: opts.monthlyAdSpend,
    industry: opts.industry,
    customCpc: realCpc ?? undefined,
  });

  const estimatedPaidCost = Math.round((opts.organicSessions + opts.aiReferralSessions) * base.estimatedCpc);

  return {
    ...base,
    estimatedPaidCost,
    keywordsPriced: realCpc !== null ? keywords.length : 0,
  };
}
