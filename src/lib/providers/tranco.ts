import type { ProviderResult } from "./types";
import { logProviderError } from "@/lib/observability/log";

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

// In-process TTL cache — authority changes slowly, so reuse within a process.
const DA_CACHE_TTL_MS = 60 * 60 * 1000;
const daCache = new Map<string, { at: number; result: ProviderResult<DomainAuthority> }>();

export async function getDomainAuthority(
  domain: string
): Promise<ProviderResult<DomainAuthority>> {
  const clean = cleanDomain(domain);
  if (!clean) return { success: false, error: "Invalid domain" };

  const cached = daCache.get(clean);
  if (cached && Date.now() - cached.at < DA_CACHE_TTL_MS) {
    return cached.result;
  }

  const result = await fetchDomainAuthority(clean);
  daCache.set(clean, { at: Date.now(), result });
  return result;
}

async function fetchDomainAuthority(
  clean: string
): Promise<ProviderResult<DomainAuthority>> {
  try {
    const res = await fetch(
      `https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } }
    );

    if (!res.ok) {
      // Service error / rate-limit is NOT the same as "genuinely unlisted":
      // report unavailable so callers fall through to other authority sources
      // rather than locking in a false 0-authority signal.
      return { success: false, error: `Tranco ${res.status}`, creditsUsed: 0 };
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
    // Network failure/timeout: unavailable (not a measured 0). Callers treat
    // success:false as "unknown authority" and fall through to other sources.
    logProviderError("tranco", error, { domain: clean });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Tranco request failed",
      creditsUsed: 0,
    };
  }
}
