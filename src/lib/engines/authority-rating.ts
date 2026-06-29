/**
 * Unified Authority Rating (AR 0-100) - an Ahrefs-DR-style domain authority
 * derived entirely from free signals, honestly blended:
 *   - Tranco rank (popularity-as-authority proxy, top-1M)
 *   - Common Crawl referring-domain breadth (real inbound link diversity)
 *   - OpenPageRank (when OmniData is deployed with a key)
 *   - Domain age (RDAP + Wayback trust proxy)
 *
 * This is a blended proxy, not Ahrefs' proprietary DR. Callers should label it
 * "Authority Rating (free-signal blend)".
 */
import { resolveDomainAuthority } from "@/lib/providers/domain-authority";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { getDomainAge } from "@/lib/providers/domain-age";
import { isOmniDataActive, labsApiPost } from "@/lib/providers/dataforseo";

export interface AuthorityRating {
  domain: string;
  /** 0-100 blended authority (DR-like). */
  rating: number;
  components: {
    /** Base authority score (Common Crawl centrality, Tranco, or rank.to-derived). */
    tranco: number;
    /** Where the base authority came from. */
    authoritySource: "commoncrawl" | "tranco" | "rank.to" | "unlisted";
    referringDomains: number;
    openPageRank?: number;
    ageYears: number;
  };
  sources: string[];
}

function logScore(value: number, scale: number): number {
  return Math.max(0, Math.min(100, Math.round(Math.log10(value + 1) * scale)));
}

/** Pull OpenPageRank (0-10) from OmniData popularity when deployed. */
async function fetchOpenPageRank(domain: string): Promise<number | undefined> {
  if (!isOmniDataActive()) return undefined;
  const res = await labsApiPost<{ tasks: Array<{ result: Array<{ components?: { page_rank?: number } }> }> }>(
    "/domain/popularity/live",
    [{ target: domain }]
  );
  const pr = res?.tasks?.[0]?.result?.[0]?.components?.page_rank;
  return typeof pr === "number" && pr > 0 ? pr : undefined;
}

export async function getAuthorityRating(domain: string): Promise<AuthorityRating> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();

  const [authority, backlinks, age, opr] = await Promise.all([
    resolveDomainAuthority(clean),
    getBacklinksFree(clean, 100).catch(() => null),
    getDomainAge(clean),
    fetchOpenPageRank(clean),
  ]);

  const tranco = authority.score;
  const authoritySource = authority.source;
  // Prefer the real distinct referring-domain count from the Common Crawl
  // webgraph (carried on the resolved authority) over counting the fetched page.
  const referringDomains = typeof authority.referringDomains === "number" && authority.referringDomains > 0
    ? authority.referringDomains
    : backlinks?.success && backlinks.data
      ? new Set(backlinks.data.map((b) => b.domain)).size
      : 0;
  const ageYears = age.ageYears ?? 0;

  const sources: string[] = [];
  const parts: Array<{ value: number; weight: number }> = [];

  if (tranco > 0) {
    // Common Crawl harmonic centrality is a true link-graph authority (strongest);
    // Tranco is a strong popularity proxy; rank.to-derived is slightly weaker.
    const baseWeight = authoritySource === "commoncrawl" ? 0.45 : authoritySource === "tranco" ? 0.4 : 0.32;
    parts.push({ value: tranco, weight: baseWeight });
    sources.push(
      authoritySource === "commoncrawl"
        ? "common_crawl_centrality"
        : authoritySource === "tranco"
          ? "tranco"
          : "rank.to"
    );
  }
  if (referringDomains > 0) {
    parts.push({ value: logScore(referringDomains, 33), weight: 0.3 });
    sources.push("common_crawl");
  }
  if (typeof opr === "number") {
    parts.push({ value: Math.min(100, opr * 10), weight: 0.2 });
    sources.push("openpagerank");
  }
  if (ageYears > 0) {
    parts.push({ value: Math.min(100, ageYears * 5), weight: 0.1 });
    sources.push("domain_age");
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const rating = totalWeight > 0
    ? Math.round(parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight)
    : 0;

  return {
    domain: clean,
    rating,
    components: { tranco, authoritySource, referringDomains, openPageRank: opr, ageYears },
    sources,
  };
}
