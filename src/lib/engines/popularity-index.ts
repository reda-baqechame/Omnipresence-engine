/**
 * Popularity Index - an HONEST relative-popularity proxy (0-100).
 *
 * This is NOT a traffic/visits estimate. We cannot replicate SimilarWeb's
 * clickstream panel from free sources, and faking absolute visit counts would
 * be a refund risk. Instead we blend free, real signals into a relative index
 * and label it as such:
 *   - Tranco authority rank (popularity proxy, top-1M)
 *   - Common Crawl referring-domain breadth
 *   - Wikipedia pageviews (public interest, when an article exists)
 *   - Domain age (trust proxy)
 */
import { getDomainAuthority } from "@/lib/providers/tranco";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { getWikiInterest } from "@/lib/providers/wikimedia";
import { getDomainAge } from "@/lib/providers/domain-age";

export interface PopularityComponents {
  authority: number;
  referringDomains: number;
  wikiViews: number;
  ageYears: number;
}

export interface PopularityIndex {
  domain: string;
  /** 0-100 relative popularity. NOT visits. */
  score: number;
  components: PopularityComponents;
  signals: string[];
  note: string;
}

const NOTE = "Relative Popularity Index (0-100) from public signals - not an absolute visit count.";

function logScore(value: number, scale: number): number {
  return Math.max(0, Math.min(100, Math.round(Math.log10(value + 1) * scale)));
}

export async function getPopularityIndex(
  domain: string,
  opts: { name?: string; includeWiki?: boolean } = {}
): Promise<PopularityIndex> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const includeWiki = opts.includeWiki ?? true;

  const [authority, backlinks, age, wiki] = await Promise.all([
    getDomainAuthority(clean),
    getBacklinksFree(clean, 100).catch(() => null),
    getDomainAge(clean),
    includeWiki && opts.name
      ? getWikiInterest(opts.name).catch(() => null)
      : Promise.resolve(null),
  ]);

  const authorityScore = authority.success && authority.data ? authority.data.authorityScore : 0;
  const referringDomains = backlinks?.success && backlinks.data
    ? new Set(backlinks.data.map((b) => b.domain)).size
    : 0;
  const wikiViews = wiki?.exists ? wiki.totalViews : 0;
  const ageYears = age.ageYears ?? 0;

  const signals: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (authorityScore > 0) {
    parts.push({ value: authorityScore, weight: 0.45 });
    signals.push("tranco");
  }
  if (referringDomains > 0) {
    parts.push({ value: logScore(referringDomains, 33), weight: 0.3 });
    signals.push("common_crawl");
  }
  if (wikiViews > 0) {
    parts.push({ value: logScore(wikiViews, 16.6), weight: 0.15 });
    signals.push("wikipedia");
  }
  if (ageYears > 0) {
    parts.push({ value: Math.min(100, ageYears * 5), weight: 0.1 });
    signals.push("domain_age");
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const score = totalWeight > 0
    ? Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight)
    : 0;

  return {
    domain: clean,
    score,
    components: { authority: authorityScore, referringDomains, wikiViews, ageYears },
    signals,
    note: NOTE,
  };
}
