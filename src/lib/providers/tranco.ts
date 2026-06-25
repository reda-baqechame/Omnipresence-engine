import type { ProviderResult } from "./types";

/**
 * Tranco domain authority — free, research-grade domain ranking list.
 * Lower rank = more authoritative. The AI link-graph heuristic rewards
 * high-authority domains (sites with large referring-domain profiles are
 * ~3.5x more likely to be cited), so we normalize Tranco rank into a
 * 0-100 authority score that feeds the AEO authority lever.
 */

export interface DomainAuthority {
  domain: string;
  /** Tranco rank (1 = most authoritative); undefined when unlisted */
  trancoRank?: number;
  /** 0-100 normalized authority score */
  authorityScore: number;
  source: "tranco" | "unlisted";
}

function cleanDomain(domain: string): string {
  return domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
}

/** Map a Tranco rank to a 0-100 authority score on a log scale. */
export function trancoRankToScore(rank: number): number {
  if (rank <= 0) return 0;
  // rank 1 -> ~100, rank 10M -> ~0
  const score = 100 * (1 - Math.log10(rank) / Math.log10(10_000_000));
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function getDomainAuthority(
  domain: string
): Promise<ProviderResult<DomainAuthority>> {
  const clean = cleanDomain(domain);
  if (!clean) return { success: false, error: "Invalid domain" };

  try {
    const res = await fetch(
      `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } }
    );

    if (!res.ok) {
      // Unreachable or rate-limited: degrade gracefully to "unlisted".
      return {
        success: true,
        data: { domain: clean, authorityScore: 0, source: "unlisted" },
        creditsUsed: 0,
      };
    }

    const data = (await res.json()) as {
      ranks?: Array<{ date: string; rank: number }>;
    };

    const latest = (data.ranks || [])
      .filter((r) => typeof r.rank === "number")
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

    if (!latest) {
      return {
        success: true,
        data: { domain: clean, authorityScore: 0, source: "unlisted" },
        creditsUsed: 0,
      };
    }

    return {
      success: true,
      data: {
        domain: clean,
        trancoRank: latest.rank,
        authorityScore: trancoRankToScore(latest.rank),
        source: "tranco",
      },
      creditsUsed: 0,
    };
  } catch (error) {
    // Never break a scan over an optional authority signal.
    return {
      success: true,
      data: { domain: clean, authorityScore: 0, source: "unlisted" },
      error: error instanceof Error ? error.message : "Tranco request failed",
      creditsUsed: 0,
    };
  }
}
