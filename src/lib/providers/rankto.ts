/**
 * rank.to — free, no-auth global domain ranking (aggregated public traffic
 * signals; a SimilarWeb-rank-style proxy). No API key, no signup. Lower rank =
 * more popular. We use it only as a RELATIVE popularity signal, never as an
 * absolute visit count. Keep request rates reasonable (shared free service).
 *
 * Response shape: { ranks: { "YYYY-MM-DD": number, ... }, time }
 */

export interface RankToResult {
  domain: string;
  /** Latest global rank (lower = more popular). */
  rank?: number;
  previousRank?: number;
  /** Rank movement over the window (improved/declined/flat). */
  trend: "up" | "down" | "flat" | "unknown";
  history: Array<{ date: string; rank: number }>;
  available: boolean;
}

function cleanDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase().trim();
}

export async function getRankToRank(domain: string, days: 7 | 14 | 30 = 30): Promise<RankToResult> {
  const clean = cleanDomain(domain);
  const empty: RankToResult = { domain: clean, trend: "unknown", history: [], available: false };
  if (!clean) return empty;

  try {
    const res = await fetch(`https://rank.to/api/?d=${encodeURIComponent(clean)}&n=${days}`, {
      headers: { Accept: "application/json", connection: "close" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as { ranks?: Record<string, number> };
    const entries = Object.entries(data.ranks || {})
      .filter(([, v]) => typeof v === "number" && v > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return empty;

    const history = entries.map(([date, rank]) => ({ date, rank }));
    const rank = history[history.length - 1].rank;
    const previousRank = history[0].rank;
    // Lower rank number = more popular, so a decreasing number is "up".
    let trend: RankToResult["trend"] = "flat";
    const delta = previousRank - rank;
    if (delta > Math.max(1, previousRank * 0.02)) trend = "up";
    else if (delta < -Math.max(1, previousRank * 0.02)) trend = "down";

    return { domain: clean, rank, previousRank, trend, history, available: true };
  } catch {
    return empty;
  }
}

/** Convert a global rank into a 0-100 popularity component (lower rank = higher). */
export function rankToPopularityScore(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - Math.log10(rank) * 16)));
}
