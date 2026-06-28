/**
 * Visibility insights — analyst-grade, claim-disciplined views computed purely
 * from VisibilityResult rows already loaded for the dashboard (no extra probes,
 * no extra cost). Two principles:
 *   1. Never count an "unavailable" probe as a 0% result — unmeasured ≠ absent.
 *   2. Surface the actionable gaps: where competitors beat you and which sources
 *      AI cites that you don't yet own.
 */

import type { VisibilityResult } from "@/types/database";

/** A probe counts as measured unless the engine explicitly couldn't be read. */
export function isMeasured(r: VisibilityResult): boolean {
  return r.data_source !== "unavailable" && r.measurement_mode !== "unavailable";
}

export interface EngineStat {
  engine: string;
  measured: number;
  unavailable: number;
  mentioned: number;
  cited: number;
  mentionRate: number | null; // null = not measured this run
  citationRate: number | null;
}

/** Per-engine stats that keep measured and unavailable strictly separate. */
export function measuredEngineStats(results: VisibilityResult[]): EngineStat[] {
  const map = new Map<string, EngineStat>();
  for (const r of results) {
    let s = map.get(r.engine);
    if (!s) {
      s = { engine: r.engine, measured: 0, unavailable: 0, mentioned: 0, cited: 0, mentionRate: null, citationRate: null };
      map.set(r.engine, s);
    }
    if (isMeasured(r)) {
      s.measured += 1;
      if (r.brand_mentioned) s.mentioned += 1;
      if (r.brand_cited) s.cited += 1;
    } else {
      s.unavailable += 1;
    }
  }
  for (const s of map.values()) {
    s.mentionRate = s.measured > 0 ? s.mentioned / s.measured : null;
    s.citationRate = s.measured > 0 ? s.cited / s.measured : null;
  }
  return [...map.values()].sort((a, b) => b.measured - a.measured);
}

export interface CompetitorWin {
  prompt: string;
  engine: string;
  competitors: string[];
}

/**
 * Prompts where a competitor was mentioned/cited but the brand was not — the
 * single most actionable list for content/AEO work. Measured probes only.
 */
export function competitorWinPrompts(results: VisibilityResult[], limit = 25): CompetitorWin[] {
  const wins: CompetitorWin[] = [];
  for (const r of results) {
    if (!isMeasured(r)) continue;
    if (r.brand_mentioned || r.brand_cited) continue;
    const compsMentioned = Object.entries(r.competitor_mentions || {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    const compsCited = Object.entries(r.competitor_citations || {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    const comps = [...new Set([...compsMentioned, ...compsCited])];
    if (comps.length === 0) continue;
    wins.push({ prompt: r.prompt_text, engine: r.engine, competitors: comps });
  }
  // De-dupe identical prompt+engine, keep the richest competitor set.
  const seen = new Map<string, CompetitorWin>();
  for (const w of wins) {
    const key = `${w.engine}::${w.prompt}`;
    const prev = seen.get(key);
    if (!prev || w.competitors.length > prev.competitors.length) seen.set(key, w);
  }
  return [...seen.values()]
    .sort((a, b) => b.competitors.length - a.competitors.length)
    .slice(0, limit);
}

export interface CitedSource {
  domain: string;
  count: number;
  ownsBrand: boolean;
}

function registrableHost(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (host.includes("/") || host.includes(":")) {
      host = new URL(host.startsWith("http") ? host : `https://${host}`).hostname;
    }
  } catch {
    /* keep raw */
  }
  return host.replace(/^www\./, "");
}

/**
 * Sources AI engines cite for your prompts, ranked by frequency. Domains that
 * are NOT your own are your earned-media/citation targets ("missing citation
 * sources" = the places AI trusts that don't yet point to you).
 */
export function topCitedSources(
  results: VisibilityResult[],
  brandDomain: string,
  limit = 20
): CitedSource[] {
  const brandHost = registrableHost(brandDomain);
  const counts = new Map<string, number>();
  for (const r of results) {
    if (!isMeasured(r)) continue;
    for (const d of r.source_domains || []) {
      const host = registrableHost(d);
      if (!host) continue;
      counts.set(host, (counts.get(host) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({
      domain,
      count,
      ownsBrand: brandHost.length > 0 && (domain === brandHost || domain.endsWith(`.${brandHost}`)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
