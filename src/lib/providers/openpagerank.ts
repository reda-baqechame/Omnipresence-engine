import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";
import { getRankToRank } from "@/lib/providers/rankto";
import type { ProviderResult } from "./types";

export interface OpenPageRankRow {
  domain: string;
  pageRankInteger: number;
  pageRankDecimal: number;
  globalRank: number | null;
}

const BASE = "https://openpagerank.com/api/v1.0/getPageRank";

/** Cached when the configured OPR API key is rejected (403/401). */
let oprApiKeyRejected = false;

function resolveApiKey(): string {
  return (process.env.OPEN_PAGERANK_API_KEY || process.env.API_OPR_KEY || "").trim();
}

function hasApiKey(): boolean {
  const k = resolveApiKey();
  return Boolean(k.length > 0 && !k.startsWith("your-") && !oprApiKeyRejected);
}

function cleanDomain(domain: string): string {
  return domain.replace(/^www\./, "").split("/")[0].toLowerCase();
}

/** Map a global popularity rank (lower = stronger) to OPR-style 0-10 integer. */
export function globalRankToPageRankInteger(globalRank: number): number {
  if (!Number.isFinite(globalRank) || globalRank <= 0) return 0;
  return Math.max(0, Math.min(10, Math.round(10 - Math.log10(globalRank))));
}

async function fetchRankToRow(domain: string): Promise<OpenPageRankRow | null> {
  const rt = await getRankToRank(domain).catch(() => null);
  if (!rt?.available || typeof rt.rank !== "number" || rt.rank <= 0) return null;
  const pageRankInteger = globalRankToPageRankInteger(rt.rank);
  return {
    domain: cleanDomain(domain),
    pageRankInteger,
    pageRankDecimal: pageRankInteger,
    globalRank: rt.rank,
  };
}

async function fetchOprApiBatch(
  domains: string[],
  key: string
): Promise<OpenPageRankRow[] | null> {
  const params = new URLSearchParams();
  for (const d of domains) params.append("domains[]", d);

  const res = await fetchWithTimeout(`${BASE}?${params}`, {
    headers: { "API-OPR": key },
    timeoutMs: 12000,
  });

  if (res.status === 401 || res.status === 403) {
    oprApiKeyRejected = true;
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as {
    response?: Array<{
      domain: string;
      page_rank_integer?: number;
      page_rank_decimal?: number;
      rank?: string | null;
      status_code?: number;
    }>;
  };

  const rows = (json.response || [])
    .filter((r) => r.status_code === 200)
    .map((r) => ({
      domain: r.domain,
      pageRankInteger: r.page_rank_integer ?? 0,
      pageRankDecimal: r.page_rank_decimal ?? 0,
      globalRank: r.rank ? Number(r.rank) : null,
    }));

  return rows.length ? rows : null;
}

/**
 * Domain PageRank signal — OpenPageRank API when a valid key is configured,
 * otherwise free rank.to global-rank fallback (same 0-10 scale, no key required).
 */
export async function getOpenPageRankBatch(
  domains: string[]
): Promise<ProviderResult<OpenPageRankRow[]>> {
  const clean = [...new Set(domains.map(cleanDomain).filter(Boolean))].slice(0, 100);
  if (!clean.length) return { success: false, error: "No domains" };

  const key = resolveApiKey();
  if (hasApiKey()) {
    try {
      const oprRows = await fetchOprApiBatch(clean, key);
      if (oprRows?.length) return { success: true, data: oprRows };
    } catch (error) {
      logProviderError("openpagerank", error);
    }
  }

  try {
    const rows: OpenPageRankRow[] = [];
    for (const d of clean) {
      const row = await fetchRankToRow(d);
      if (row) rows.push(row);
    }
    if (!rows.length) return { success: false, error: "No domain authority resolved" };
    return { success: true, data: rows };
  } catch (error) {
    logProviderError("openpagerank", error);
    return { success: false, error: error instanceof Error ? error.message : "PageRank failed" };
  }
}

export async function getOpenPageRank(domain: string): Promise<ProviderResult<OpenPageRankRow>> {
  const batch = await getOpenPageRankBatch([domain]);
  if (!batch.success || !batch.data?.length) {
    return { success: false, error: batch.error || "Domain not found" };
  }
  return { success: true, data: batch.data[0] };
}

/** True — rank.to fallback is always available; OPR API is optional when keyed. */
export function hasOpenPageRankCapability(): boolean {
  return true;
}

/** Map OPR 0-10 integer to our 0-100 authority scale. */
export function oprToAuthorityScore(pageRankInteger: number): number {
  return Math.max(0, Math.min(100, Math.round(pageRankInteger * 10)));
}
