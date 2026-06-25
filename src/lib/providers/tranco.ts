import { normalizeDomain } from "@/lib/utils";
import type { ProviderResult } from "./types";

/**
 * Tranco domain-popularity provider — a research-grade top-sites ranking
 * aggregated from independent sources, distributed under a permissive academic
 * license that explicitly allows commercial use (no strings).
 *
 * The raw rank is a real, measured popularity position. We also expose a
 * normalised 0–100 "authority" signal derived from the rank on a log scale —
 * clearly an authority proxy, not a third-party DR metric.
 *
 * Docs: https://tranco-list.eu/ — API: https://tranco-list.eu/api/ranks/domain/{domain}
 */

const TRANCO_API = "https://tranco-list.eu/api/ranks/domain";

export interface DomainAuthority {
  domain: string;
  /** Latest Tranco rank (1 = most popular). Undefined when the domain is unranked. */
  rank?: number;
  /** 0–100 authority proxy derived from rank on a log scale. */
  authorityScore: number;
  ranked: boolean;
  data_source: "measured";
}

interface TrancoResponse {
  ranks?: Array<{ date: string; rank: number }>;
  rank?: number;
}

/** Map a Tranco rank to a 0–100 authority proxy. Rank 1 → 100, ~10M → 0. */
export function rankToAuthorityScore(rank: number | undefined): number {
  if (!rank || rank < 1) return 0;
  const score = 100 - (Math.log10(rank) / 7) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function getDomainAuthority(
  domain: string
): Promise<ProviderResult<DomainAuthority>> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { success: false, error: "Invalid domain" };

  try {
    const response = await fetch(`${TRANCO_API}/${encodeURIComponent(normalized)}`, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      // Unranked domains can return 404 — treat as a valid "no rank" result.
      if (response.status === 404) {
        return {
          success: true,
          data: { domain: normalized, authorityScore: 0, ranked: false, data_source: "measured" },
          creditsUsed: 0,
        };
      }
      return { success: false, error: `Tranco API error: ${response.status}` };
    }

    const data = (await response.json()) as TrancoResponse;
    const latestRank =
      data.ranks?.length ? data.ranks[data.ranks.length - 1]?.rank : data.rank;

    return {
      success: true,
      data: {
        domain: normalized,
        rank: latestRank,
        authorityScore: rankToAuthorityScore(latestRank),
        ranked: typeof latestRank === "number" && latestRank > 0,
        data_source: "measured",
      },
      creditsUsed: 1,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Tranco request failed",
    };
  }
}
