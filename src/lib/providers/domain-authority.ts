/**
 * Unified domain-authority resolver — closes the "Tranco = top-1M only" gap.
 *
 * Tranco only ranks the top ~1M domains, so smaller (but real) sites returned a
 * 0/"unlisted" authority, understating KD, Authority Rating, and the AEO
 * authority lever. We now resolve a real 0-100 authority for a far larger domain
 * universe by chaining keyless sources, most-authoritative first:
 *
 *   1. Tranco rank (research-grade top-1M) — best signal when present.
 *   2. rank.to global rank (covers millions of domains, no auth) — fallback.
 *
 * Everything degrades to source="unlisted" (score 0) only when nothing resolves.
 * The source is always returned so callers can label provenance honestly.
 */
import { getDomainAuthority } from "@/lib/providers/tranco";
import { getRankToRank, rankToPopularityScore } from "@/lib/providers/rankto";

export interface ResolvedAuthority {
  domain: string;
  /** 0-100 authority score. */
  score: number;
  source: "tranco" | "rank.to" | "unlisted";
  trancoRank?: number;
  globalRank?: number;
}

function clean(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

/**
 * Resolve authority for any domain. Pass a pre-fetched rank.to rank via
 * `opts.globalRank` to avoid a duplicate network call when the caller already
 * has it (e.g. the Popularity Index / competitive snapshot).
 */
export async function resolveDomainAuthority(
  domain: string,
  opts: { globalRank?: number } = {}
): Promise<ResolvedAuthority> {
  const d = clean(domain);
  if (!d) return { domain: d, score: 0, source: "unlisted" };

  const tranco = await getDomainAuthority(d).catch(() => null);
  if (tranco?.success && tranco.data && tranco.data.source === "tranco" && tranco.data.authorityScore > 0) {
    return {
      domain: d,
      score: tranco.data.authorityScore,
      source: "tranco",
      trancoRank: tranco.data.trancoRank,
    };
  }

  // Tranco unlisted: fall back to rank.to's far broader global rank.
  let globalRank = opts.globalRank;
  if (typeof globalRank !== "number") {
    const rt = await getRankToRank(d).catch(() => null);
    if (rt?.available && typeof rt.rank === "number") globalRank = rt.rank;
  }
  if (typeof globalRank === "number") {
    return { domain: d, score: rankToPopularityScore(globalRank), source: "rank.to", globalRank };
  }

  return { domain: d, score: 0, source: "unlisted" };
}
