import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";
import type { ProviderResult } from "./types";

export interface OpenPageRankRow {
  domain: string;
  pageRankInteger: number;
  pageRankDecimal: number;
  globalRank: number | null;
}

const BASE = "https://openpagerank.com/api/v1.0/getPageRank";

function hasKey(): boolean {
  const k = process.env.OPEN_PAGERANK_API_KEY || process.env.API_OPR_KEY;
  return Boolean(k && k.length > 0 && !k.startsWith("your-"));
}

/**
 * DomCop Open PageRank — free tier 10k req/hr. Batch up to 100 domains per call.
 * Data from Common Crawl (commercial-safe for SaaS redistribution of scores).
 */
export async function getOpenPageRankBatch(
  domains: string[]
): Promise<ProviderResult<OpenPageRankRow[]>> {
  if (!hasKey()) {
    return { success: false, error: "OPEN_PAGERANK_API_KEY not configured" };
  }
  const clean = [...new Set(domains.map((d) => d.replace(/^www\./, "").split("/")[0].toLowerCase()))].filter(Boolean);
  if (!clean.length) return { success: false, error: "No domains" };

  const key = process.env.OPEN_PAGERANK_API_KEY || process.env.API_OPR_KEY || "";
  const params = new URLSearchParams();
  for (const d of clean.slice(0, 100)) params.append("domains[]", d);

  try {
    const res = await fetchWithTimeout(`${BASE}?${params}`, {
      headers: { "API-OPR": key },
      timeoutMs: 12000,
    });
    if (!res.ok) return { success: false, error: `OpenPageRank HTTP ${res.status}` };
    const json = (await res.json()) as {
      response?: Array<{
        domain: string;
        page_rank_integer?: number;
        page_rank_decimal?: number;
        rank?: string | null;
        status_code?: number;
      }>;
    };
    const rows: OpenPageRankRow[] = (json.response || [])
      .filter((r) => r.status_code === 200)
      .map((r) => ({
        domain: r.domain,
        pageRankInteger: r.page_rank_integer ?? 0,
        pageRankDecimal: r.page_rank_decimal ?? 0,
        globalRank: r.rank ? Number(r.rank) : null,
      }));
    return { success: true, data: rows };
  } catch (error) {
    logProviderError("openpagerank", error);
    return { success: false, error: error instanceof Error ? error.message : "OpenPageRank failed" };
  }
}

export async function getOpenPageRank(domain: string): Promise<ProviderResult<OpenPageRankRow>> {
  const batch = await getOpenPageRankBatch([domain]);
  if (!batch.success || !batch.data?.length) {
    return { success: false, error: batch.error || "Domain not found" };
  }
  return { success: true, data: batch.data[0] };
}

export function hasOpenPageRankCapability(): boolean {
  return hasKey();
}

/** Map OPR 0-10 integer to our 0-100 authority scale. */
export function oprToAuthorityScore(pageRankInteger: number): number {
  return Math.max(0, Math.min(100, Math.round(pageRankInteger * 10)));
}
