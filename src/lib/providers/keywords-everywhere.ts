import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";
import type { ProviderResult } from "./types";

const BASE = "https://api.keywordseverywhere.com/v1";

export interface KeywordEverywhereRow {
  keyword: string;
  volume: number;
  cpc?: number;
  competition?: number;
}

function hasKey(): boolean {
  const k = process.env.KEYWORDS_EVERYWHERE_API_KEY;
  return Boolean(k && k.trim() && !k.startsWith("your-"));
}

function formBody(params: Record<string, string | string[]>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const v of value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join("&");
}

/**
 * Keywords Everywhere — Google Keyword Planner volume/CPC (paid credits).
 * Batch up to 100 keywords per request.
 */
export async function getKeywordDataBatch(
  keywords: string[],
  options?: { country?: string; currency?: string }
): Promise<ProviderResult<KeywordEverywhereRow[]>> {
  if (!hasKey()) {
    return { success: false, error: "KEYWORDS_EVERYWHERE_API_KEY not configured" };
  }

  const clean = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))].slice(0, 100);
  if (!clean.length) return { success: false, error: "No keywords" };

  const key = process.env.KEYWORDS_EVERYWHERE_API_KEY || "";
  const country = options?.country || process.env.KEYWORDS_EVERYWHERE_COUNTRY?.trim() || "us";
  const currency = options?.currency || process.env.KEYWORDS_EVERYWHERE_CURRENCY?.trim() || "usd";

  try {
    const res = await fetchWithTimeout(`${BASE}/get_keyword_data`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody({
        dataSource: "gkp",
        country,
        currency,
        "kw[]": clean,
      }),
      timeoutMs: 20000,
    });

    if (!res.ok) return { success: false, error: `Keywords Everywhere HTTP ${res.status}` };

    const json = (await res.json()) as {
      data?: Array<{
        keyword: string;
        vol?: number;
        cpc?: { value?: string };
        competition?: number;
      }>;
    };

    const rows: KeywordEverywhereRow[] = (json.data || []).map((r) => ({
      keyword: r.keyword,
      volume: r.vol ?? 0,
      cpc: r.cpc?.value ? Number(r.cpc.value) : undefined,
      competition: r.competition,
    }));

    return { success: true, data: rows, creditsUsed: rows.length };
  } catch (error) {
    logProviderError("keywords-everywhere", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Keywords Everywhere failed",
    };
  }
}

export async function getKeywordData(keyword: string): Promise<ProviderResult<KeywordEverywhereRow>> {
  const batch = await getKeywordDataBatch([keyword]);
  if (!batch.success || !batch.data?.length) {
    return { success: false, error: batch.error || "Keyword not found" };
  }
  return { success: true, data: batch.data[0], creditsUsed: batch.creditsUsed };
}

export function hasKeywordsEverywhereCapability(): boolean {
  return hasKey();
}
