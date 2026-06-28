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

/**
 * Defensive coercion of freeform DB JSON. The TS types say these columns are a
 * boolean-map / string-array, but the database stores JSON and legacy or
 * externally-written rows can hold null, a string, or the wrong container. A raw
 * `for…of` over a non-array throws ("not iterable") and crashes the whole page,
 * so every read of these columns goes through these guards.
 */
function asBoolMap(v: unknown): Record<string, boolean> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, boolean>;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** Names of competitors mentioned or cited in a single answer (deduped). */
function winningEntities(r: VisibilityResult): string[] {
  return [
    ...new Set([
      ...Object.entries(asBoolMap(r.competitor_mentions)).filter(([, v]) => v).map(([k]) => k),
      ...Object.entries(asBoolMap(r.competitor_citations)).filter(([, v]) => v).map(([k]) => k),
    ]),
  ];
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
    const comps = winningEntities(r);
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

export interface EntityVisibilityRate {
  measured: number;
  mentioned: number;
  cited: number;
  mentionRate: number | null;
  citationRate: number | null;
}

/**
 * Per-entity (brand + each competitor) AI mention/citation rate over the same
 * pool of measured probes. Lets the competitive matrix show head-to-head AI
 * visibility next to authority/popularity. Competitor keys match the project's
 * competitor identifiers (the same keys the scanner stores in
 * competitor_mentions / competitor_citations).
 */
export function competitorVisibilityRates(
  results: VisibilityResult[],
  competitors: string[]
): { brand: EntityVisibilityRate; competitors: Record<string, EntityVisibilityRate> } {
  const blank = (): EntityVisibilityRate => ({ measured: 0, mentioned: 0, cited: 0, mentionRate: null, citationRate: null });
  const brand = blank();
  const comp: Record<string, EntityVisibilityRate> = {};
  for (const c of competitors) comp[c] = blank();

  for (const r of results) {
    if (!isMeasured(r)) continue;
    brand.measured += 1;
    if (r.brand_mentioned) brand.mentioned += 1;
    if (r.brand_cited) brand.cited += 1;
    const mentions = asBoolMap(r.competitor_mentions);
    const citations = asBoolMap(r.competitor_citations);
    for (const c of competitors) {
      comp[c].measured += 1;
      if (mentions[c]) comp[c].mentioned += 1;
      if (citations[c]) comp[c].cited += 1;
    }
  }

  const finalize = (e: EntityVisibilityRate) => {
    e.mentionRate = e.measured > 0 ? e.mentioned / e.measured : null;
    e.citationRate = e.measured > 0 ? e.cited / e.measured : null;
    return e;
  };
  finalize(brand);
  for (const c of competitors) finalize(comp[c]);
  return { brand, competitors: comp };
}

export interface PagePlay {
  prompt: string;
  engines: string[];
  competitors: string[];
  reason: string;
}

export interface PageOpportunities {
  create: PagePlay[];
  update: PagePlay[];
}

/**
 * Turn measured probe outcomes into a concrete content worklist:
 *   - create: prompts where you're absent but a competitor wins → build a new
 *     answer-first page to enter the answer.
 *   - update: prompts where you're MENTIONED but not CITED → you already have a
 *     page in the model's view; strengthen it (cit* able facts, schema,
 *     answer-first structure) to convert the mention into a citation.
 * Deduped by prompt across engines so each play appears once.
 */
export function pageOpportunities(results: VisibilityResult[], limit = 20): PageOpportunities {
  const createMap = new Map<string, PagePlay>();
  const updateMap = new Map<string, PagePlay>();

  for (const r of results) {
    if (!isMeasured(r)) continue;
    const prompt = r.prompt_text;
    if (!prompt) continue;

    if (!r.brand_mentioned && !r.brand_cited) {
      const comps = winningEntities(r);
      if (comps.length === 0) continue; // absent but nobody wins → not a clear play
      const prev = createMap.get(prompt);
      if (prev) {
        prev.engines = [...new Set([...prev.engines, r.engine])];
        prev.competitors = [...new Set([...prev.competitors, ...comps])];
      } else {
        createMap.set(prompt, {
          prompt,
          engines: [r.engine],
          competitors: comps,
          reason: "You're absent here while competitors win the answer — create an answer-first page targeting this query.",
        });
      }
    } else if (r.brand_mentioned && !r.brand_cited) {
      const prev = updateMap.get(prompt);
      if (prev) {
        prev.engines = [...new Set([...prev.engines, r.engine])];
      } else {
        updateMap.set(prompt, {
          prompt,
          engines: [r.engine],
          competitors: [],
          reason: "You're mentioned but not cited — strengthen the page with citable facts + schema to earn the link.",
        });
      }
    }
  }

  const byReach = (a: PagePlay, b: PagePlay) => b.engines.length - a.engines.length;
  return {
    create: [...createMap.values()].sort((a, b) => b.competitors.length - a.competitors.length || byReach(a, b)).slice(0, limit),
    update: [...updateMap.values()].sort(byReach).slice(0, limit),
  };
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
    for (const d of asStringArray(r.source_domains)) {
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

export interface MissingCitationSource {
  domain: string;
  /** How many measured answers cited this domain while the brand was NOT cited. */
  count: number;
  /** Competitors that appeared in those same answers (your rivals on this source). */
  competitors: string[];
}

/**
 * The sharpest outreach list: third-party domains AI cites in answers where a
 * competitor wins and YOU are absent (not cited). These are the exact sources
 * feeding your competitors' citations but not yours — get featured here and you
 * get pulled into the answers you're currently losing. Excludes your own domain
 * and any domain that already cites you in some other answer (those aren't
 * "missing"). Measured probes only.
 */
export function missingCitationSources(
  results: VisibilityResult[],
  brandDomain: string,
  limit = 20
): MissingCitationSource[] {
  const brandHost = registrableHost(brandDomain);
  const isOwn = (host: string) =>
    brandHost.length > 0 && (host === brandHost || host.endsWith(`.${brandHost}`));

  // Domains that cite the brand in ANY measured answer are already "won" — drop them.
  const citesBrand = new Set<string>();
  for (const r of results) {
    if (!isMeasured(r) || !r.brand_cited) continue;
    for (const d of asStringArray(r.source_domains)) {
      const host = registrableHost(d);
      if (host) citesBrand.add(host);
    }
  }

  const agg = new Map<string, { count: number; comps: Set<string> }>();
  for (const r of results) {
    if (!isMeasured(r)) continue;
    if (r.brand_cited) continue; // we're already cited here → not a loss
    const comps = winningEntities(r);
    if (comps.length === 0) continue; // absent but nobody wins → not an outreach target
    for (const d of asStringArray(r.source_domains)) {
      const host = registrableHost(d);
      if (!host || isOwn(host) || citesBrand.has(host)) continue;
      let e = agg.get(host);
      if (!e) {
        e = { count: 0, comps: new Set() };
        agg.set(host, e);
      }
      e.count += 1;
      for (const c of comps) e.comps.add(c);
    }
  }

  return [...agg.entries()]
    .map(([domain, e]) => ({ domain, count: e.count, competitors: [...e.comps] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
