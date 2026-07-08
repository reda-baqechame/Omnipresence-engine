/**
 * Cache-aware wrapper around getRealKeywordCpcDetailed() (Patch C.1).
 *
 * Two problems this closes:
 *  1. Cost/latency: gatherReportData() previously re-fetched real Keyword
 *     Planner CPC on every report generation with zero reuse, even when the
 *     same keywords were priced in a recent report for the same or a
 *     different project. keyword_cpc_cache (migration 0082) makes repeat
 *     lookups free and instant for up to 30 days.
 *  2. Cancellation latency: a cancelled report that would otherwise still
 *     have to wait out a live network call can instead resolve immediately
 *     from cache (or skip entirely — see the isCancelled check in
 *     report-builder.ts, which happens BEFORE this module is ever called).
 *
 * This module never fabricates a value: a cache miss with no fresh fetch
 * available returns null, exactly like getRealKeywordCpc() always has —
 * callers fall back to calculateAdsEquivalent()'s honest "industry_estimate"
 * cpcSource, never a fake "real" label.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRealKeywordCpcDetailed, type GetKeywordCpcOptions } from "@/lib/providers/dataforseo";
import { logProviderError } from "@/lib/observability/log";

export const DEFAULT_CPC_GEO = "US";
const CACHE_TTL_DAYS = 30;

function cleanKeyword(k: string): string {
  return k.trim().toLowerCase();
}

interface CpcCacheRow {
  keyword: string;
  cpc: number;
}

/** Reads still-fresh (<=30d) cached CPC rows for the given keywords/geo. */
async function readCpcCache(
  supabase: SupabaseClient,
  keywords: string[],
  geo: string
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (keywords.length === 0) return result;
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("keyword_cpc_cache")
      .select("keyword, cpc")
      .eq("geo", geo)
      .in("keyword", keywords)
      .gte("fetched_at", cutoff);
    if (error || !data) return result;
    for (const row of data as CpcCacheRow[]) {
      const cpc = Number(row.cpc);
      if (Number.isFinite(cpc) && cpc > 0) result.set(row.keyword, cpc);
    }
  } catch (e) {
    // Cache is a pure optimization — a read failure must fall through to a
    // live lookup, never block or fake report generation.
    logProviderError("keyword-cpc-cache.read", e, { geo });
  }
  return result;
}

/** Best-effort cache write for freshly-fetched real CPC values. Never throws. */
async function writeCpcCache(
  supabase: SupabaseClient,
  details: Array<{ keyword: string; cpc: number }>,
  geo: string
): Promise<void> {
  if (details.length === 0) return;
  try {
    const rows = details.map((d) => ({
      keyword: d.keyword,
      geo,
      cpc: d.cpc,
      data_source: "keyword_planner",
      fetched_at: new Date().toISOString(),
    }));
    await supabase.from("keyword_cpc_cache").upsert(rows, { onConflict: "keyword,geo" });
  } catch (e) {
    logProviderError("keyword-cpc-cache.write", e, { geo, count: details.length });
  }
}

export interface GetCachedRealKeywordCpcOptions extends GetKeywordCpcOptions {
  geo?: string;
}

/**
 * Cache-first real CPC lookup: serves fresh cached per-keyword values
 * without any network call, fetches only the keywords still missing from
 * cache, persists fresh results, and returns the blended average across
 * whatever real (cached + freshly-fetched) values were found. Returns null
 * only when NOTHING real is available for any requested keyword — callers
 * must treat that as "unavailable", never as zero.
 */
export async function getCachedRealKeywordCpc(
  supabase: SupabaseClient,
  keywords: string[],
  opts: GetCachedRealKeywordCpcOptions = {}
): Promise<number | null> {
  const geo = opts.geo || DEFAULT_CPC_GEO;
  const clean = Array.from(new Set(keywords.map(cleanKeyword).filter(Boolean))).slice(0, 200);
  if (clean.length === 0) return null;

  const cached = await readCpcCache(supabase, clean, geo);
  const missing = clean.filter((k) => !cached.has(k));

  let fetched: Array<{ keyword: string; cpc: number }> = [];
  if (missing.length > 0) {
    const details = await getRealKeywordCpcDetailed(missing, {
      allowFreshDataForSeoCpc: opts.allowFreshDataForSeoCpc,
    });
    if (details && details.length > 0) {
      fetched = details;
      await writeCpcCache(supabase, fetched, geo);
    }
  }

  const all: number[] = [...cached.values(), ...fetched.map((f) => f.cpc)];
  if (all.length === 0) return null;
  return Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100;
}
