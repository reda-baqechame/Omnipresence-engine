/**
 * Sovereign popularity signal — honest SimilarWeb-style proxy.
 *
 * No free API exposes absolute visit counts (SimilarWeb uses a proprietary
 * clickstream panel). This engine blends public popularity signals into a
 * relative tier (1-10) and a 0-100 index, always labeled `estimated_proxy`.
 *
 * Signal priority (weighted blend):
 *   1. Cloudflare Radar domain rank bucket (CC BY-NC 4.0 — attribution required)
 *   2. Tranco research-grade rank
 *   3. rank.to global rank + trend
 *   4. Common Crawl webgraph PageRank / harmonic centrality (crawl-frequency proxy)
 *   5. CrUX origin-level field assessment (real-user traffic tier)
 */
import { getRadarDomainRank, hasCloudflareRadarCapability } from "@/lib/providers/cloudflare-radar";
import { getDomainAuthority, trancoRankToScore } from "@/lib/providers/tranco";
import { getRankToRank, rankToPopularityScore } from "@/lib/providers/rankto";
import { getCcWebGraphAuthority, hasCcWebGraphCapability } from "@/lib/providers/ccwebgraph";
import { getPageSpeed } from "@/lib/providers/pagespeed";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";

export type PopularityDataSource =
  | "cloudflare_radar"
  | "tranco"
  | "rank.to"
  | "common_crawl_webgraph"
  | "common_crawl_backlinks"
  | "crux";

export interface PopularitySignalAttribution {
  source: PopularityDataSource;
  license?: string;
  note?: string;
}

export interface PopularitySignal {
  domain: string;
  /** Relative popularity index 0-100 (NOT visits). */
  popularityIndex: number;
  /** Human-friendly tier 1 (low) .. 10 (high). */
  popularityTier: number;
  /** Always `estimated_proxy` — never implies measured traffic. */
  dataQuality: "estimated_proxy";
  dataSources: PopularityDataSource[];
  attributions: PopularitySignalAttribution[];
  globalRank?: number;
  rankTrend?: "up" | "down" | "flat" | "unknown";
  trancoRank?: number;
  radarBucket?: string | null;
  cruxAssessment?: "good" | "needs-improvement" | "poor" | "unknown";
  referringDomains?: number;
  available: boolean;
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase().trim();
}

function indexToTier(index: number): number {
  if (index <= 0) return 0;
  return Math.max(1, Math.min(10, Math.ceil(index / 10)));
}

function cruxToScore(assessment: string | undefined): number {
  if (assessment === "good") return 75;
  if (assessment === "needs-improvement") return 45;
  if (assessment === "poor") return 20;
  return 0;
}

function logScore(value: number, scale: number): number {
  return Math.max(0, Math.min(100, Math.round(Math.log10(value + 1) * scale)));
}

export async function getPopularitySignal(
  domain: string,
  opts: { includeCrux?: boolean; includeBacklinks?: boolean } = {}
): Promise<PopularitySignal> {
  const d = cleanDomain(domain);
  const empty: PopularitySignal = {
    domain: d,
    popularityIndex: 0,
    popularityTier: 0,
    dataQuality: "estimated_proxy",
    dataSources: [],
    attributions: [],
    available: false,
  };
  if (!d) return empty;

  const includeCrux = opts.includeCrux !== false;
  const includeBacklinks = opts.includeBacklinks !== false;

  const [radar, trancoRes, rankto, ccwg, ps, backlinks] = await Promise.all([
    hasCloudflareRadarCapability() ? getRadarDomainRank(d).catch(() => null) : Promise.resolve(null),
    getDomainAuthority(d).catch(() => null),
    getRankToRank(d).catch(() => null),
    hasCcWebGraphCapability() ? getCcWebGraphAuthority(d).catch(() => null) : Promise.resolve(null),
    includeCrux ? getPageSpeed(d, "mobile").catch(() => null) : Promise.resolve(null),
    includeBacklinks ? getBacklinksFree(d, 50).catch(() => null) : Promise.resolve(null),
  ]);

  const parts: Array<{ value: number; weight: number }> = [];
  const dataSources: PopularityDataSource[] = [];
  const attributions: PopularitySignalAttribution[] = [];

  if (radar && radar.popularityScore > 0) {
    parts.push({ value: radar.popularityScore, weight: 0.22 });
    dataSources.push("cloudflare_radar");
    attributions.push({
      source: "cloudflare_radar",
      license: radar.license,
      note: "Cite Cloudflare Radar in methodology when this signal is shown.",
    });
  }

  const trancoRank = trancoRes?.success && trancoRes.data?.trancoRank ? trancoRes.data.trancoRank : undefined;
  const trancoScore = trancoRes?.success && trancoRes.data ? trancoRes.data.authorityScore : 0;
  if (trancoScore > 0) {
    parts.push({ value: trancoScore, weight: 0.24 });
    dataSources.push("tranco");
    attributions.push({ source: "tranco", note: "Research-grade domain ranking list." });
  }

  const globalRank = rankto?.available ? rankto.rank : undefined;
  if (typeof globalRank === "number") {
    parts.push({ value: rankToPopularityScore(globalRank), weight: 0.26 });
    dataSources.push("rank.to");
    attributions.push({ source: "rank.to", note: "Relative global rank proxy — not visit counts." });
  }

  if (ccwg && ccwg.pageRankNorm > 0) {
    parts.push({ value: ccwg.pageRankNorm, weight: 0.18 });
    dataSources.push("common_crawl_webgraph");
    attributions.push({
      source: "common_crawl_webgraph",
      note: "Common Crawl PageRank — crawl-frequency / link-graph proxy.",
    });
  }

  const referringDomains =
    backlinks?.success && backlinks.data
      ? new Set(backlinks.data.map((b) => b.domain)).size
      : 0;
  if (referringDomains > 0) {
    parts.push({ value: logScore(referringDomains, 33), weight: 0.12 });
    dataSources.push("common_crawl_backlinks");
    attributions.push({
      source: "common_crawl_backlinks",
      note: "Referring-domain count from Common Crawl webgraph when edges are ready.",
    });
  }

  const cruxAssessment = ps?.success && ps.data?.field ? ps.data.field.assessment : undefined;
  const cruxScore = cruxToScore(cruxAssessment);
  if (cruxScore > 0) {
    parts.push({ value: cruxScore, weight: 0.08 });
    dataSources.push("crux");
    attributions.push({ source: "crux", note: "Chrome UX Report origin-level real-user signal." });
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const popularityIndex =
    totalWeight > 0
      ? Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight)
      : 0;

  return {
    domain: d,
    popularityIndex,
    popularityTier: indexToTier(popularityIndex),
    dataQuality: "estimated_proxy",
    dataSources,
    attributions,
    globalRank,
    rankTrend: rankto?.available ? rankto.trend : undefined,
    trancoRank,
    radarBucket: radar?.rankBucket ?? null,
    cruxAssessment,
    referringDomains: referringDomains > 0 ? referringDomains : undefined,
    available: parts.length > 0,
  };
}

/** Export tranco rank helper for tests. */
export { trancoRankToScore };
