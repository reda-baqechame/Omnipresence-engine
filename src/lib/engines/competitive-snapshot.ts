/**
 * Unified competitive snapshot — one pass over the free signal stack to produce
 * the head-to-head matrix incumbents charge for, with honest labels:
 *   - Popularity Index (relative, not visits): rank.to + Tranco + Common Crawl
 *     referring domains + Wikipedia pageviews + domain age
 *   - Authority Rating (DR-style blend): Tranco + Common Crawl + OpenPageRank + age
 *   - Tech stack (best-effort fingerprint)
 *   - Real-user Core Web Vitals (CrUX field via PageSpeed)
 *
 * Shared signals are fetched ONCE per domain (no duplicate network across the
 * popularity/authority engines) so the matrix stays fast for several domains.
 */
import { getDomainAuthority } from "@/lib/providers/tranco";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { getDomainAge } from "@/lib/providers/domain-age";
import { getRankToRank, rankToPopularityScore } from "@/lib/providers/rankto";
import { getWikiInterest } from "@/lib/providers/wikimedia";
import { detectTechStack } from "@/lib/engines/tech-stack";
import { getPageSpeed, type CruxFieldData } from "@/lib/providers/pagespeed";

export interface CompetitiveSnapshot {
  target: string;
  domain: string;
  popularity: { score: number; signals: string[]; globalRank?: number; rankTrend?: string; available: boolean };
  authority: { rating: number; sources: string[]; available: boolean };
  techCategories: Record<string, string[]>;
  techAvailable: boolean;
  cwv?: CruxFieldData;
  components: {
    tranco: number;
    referringDomains: number;
    ageYears: number;
    wikiViews: number;
    globalRank?: number;
  };
}

function logScore(value: number, scale: number): number {
  return Math.max(0, Math.min(100, Math.round(Math.log10(value + 1) * scale)));
}

function clean(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

export async function getCompetitiveSnapshot(
  target: string,
  opts: { name?: string; includeWiki?: boolean; includeCwv?: boolean } = {}
): Promise<CompetitiveSnapshot> {
  const domain = clean(target);
  const [authorityRes, backlinks, age, rankto, wiki, tech, ps] = await Promise.all([
    getDomainAuthority(domain).catch(() => null),
    getBacklinksFree(domain, 100).catch(() => null),
    getDomainAge(domain).catch(() => null),
    getRankToRank(domain).catch(() => null),
    opts.includeWiki && opts.name ? getWikiInterest(opts.name).catch(() => null) : Promise.resolve(null),
    detectTechStack(domain).catch(() => null),
    opts.includeCwv ? getPageSpeed(domain, "mobile").catch(() => null) : Promise.resolve(null),
  ]);

  const tranco = authorityRes?.success && authorityRes.data ? authorityRes.data.authorityScore : 0;
  const referringDomains = backlinks?.success && backlinks.data
    ? new Set(backlinks.data.map((b) => b.domain)).size
    : 0;
  const ageYears = age?.ageYears ?? 0;
  const wikiViews = wiki?.exists ? wiki.totalViews : 0;
  const globalRank = rankto?.available ? rankto.rank : undefined;

  // Popularity Index (relative).
  const popParts: Array<{ value: number; weight: number }> = [];
  const popSignals: string[] = [];
  if (typeof globalRank === "number") { popParts.push({ value: rankToPopularityScore(globalRank), weight: 0.4 }); popSignals.push("rank.to"); }
  if (tranco > 0) { popParts.push({ value: tranco, weight: 0.4 }); popSignals.push("tranco"); }
  if (referringDomains > 0) { popParts.push({ value: logScore(referringDomains, 33), weight: 0.3 }); popSignals.push("common_crawl"); }
  if (wikiViews > 0) { popParts.push({ value: logScore(wikiViews, 16.6), weight: 0.15 }); popSignals.push("wikipedia"); }
  if (ageYears > 0) { popParts.push({ value: Math.min(100, ageYears * 5), weight: 0.1 }); popSignals.push("domain_age"); }
  const popWeight = popParts.reduce((s, p) => s + p.weight, 0);
  const popularityScore = popWeight > 0 ? Math.round(popParts.reduce((s, p) => s + p.value * p.weight, 0) / popWeight) : 0;

  // Authority Rating (DR-style). When Tranco is unlisted (domain outside the
  // top-1M), fall back to the rank.to-derived score so smaller real domains
  // still get a non-zero authority instead of "unranked".
  const authBase = tranco > 0 ? tranco : typeof globalRank === "number" ? rankToPopularityScore(globalRank) : 0;
  const authBaseSource = tranco > 0 ? "tranco" : typeof globalRank === "number" ? "rank.to" : "unlisted";
  const authParts: Array<{ value: number; weight: number }> = [];
  const authSources: string[] = [];
  if (authBase > 0) { authParts.push({ value: authBase, weight: authBaseSource === "tranco" ? 0.45 : 0.36 }); authSources.push(authBaseSource); }
  if (referringDomains > 0) { authParts.push({ value: logScore(referringDomains, 33), weight: 0.35 }); authSources.push("common_crawl"); }
  if (ageYears > 0) { authParts.push({ value: Math.min(100, ageYears * 5), weight: 0.2 }); authSources.push("domain_age"); }
  const authWeight = authParts.reduce((s, p) => s + p.weight, 0);
  const authorityRating = authWeight > 0 ? Math.round(authParts.reduce((s, p) => s + p.value * p.weight, 0) / authWeight) : 0;

  return {
    target,
    domain,
    popularity: { score: popularityScore, signals: popSignals, globalRank, rankTrend: rankto?.available ? rankto.trend : undefined, available: popParts.length > 0 },
    authority: { rating: authorityRating, sources: authSources, available: authParts.length > 0 },
    techCategories: tech?.categories || {},
    techAvailable: Boolean(tech?.available),
    cwv: ps?.success && ps.data ? ps.data.field : undefined,
    components: { tranco, referringDomains, ageYears, wikiViews, globalRank },
  };
}
