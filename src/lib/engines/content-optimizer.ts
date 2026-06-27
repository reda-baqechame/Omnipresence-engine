import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { scrapePage } from "@/lib/providers/firecrawl";
import { contentTerms, termFrequencies, entities } from "@/lib/nlp/wink";
import { logProviderError } from "@/lib/observability/log";

/**
 * Keyless content optimization scoring (Surfer/Clearscope-class), Phase 2.
 *
 * For a target keyword we pull the live top-10 SERP, scrape the ranking pages,
 * and compute the term/entity/word-count profile of what currently wins. A
 * draft (or target URL) is then scored 0-100 against that profile with concrete
 * term/entity gaps to close. 100% keyless — no Surfer/Clearscope subscription.
 *
 * Refund-safety: returns `available:false` (never a fabricated score) when no
 * SERP provider is configured or too few competitor pages could be scraped.
 */

export interface TermTarget {
  term: string;
  /** Fraction of top pages that use this term (0-1). */
  prevalence: number;
  /** Recommended usage count (median across pages that use it). */
  recommended: number;
  /** Times the term appears in the draft. */
  inDraft: number;
  status: "missing" | "underused" | "ok";
}

export interface EntityTarget {
  entity: string;
  type: string;
  prevalence: number;
  inDraft: boolean;
}

export interface ContentScoreResult {
  available: boolean;
  reason?: string;
  data_source: "measured" | "unavailable";
  keyword: string;
  competitorsAnalyzed: number;
  medianWordCount: number;
  draftWordCount: number;
  score: number;
  termTargets: TermTarget[];
  entityTargets: EntityTarget[];
  headingSuggestions: string[];
  paaQuestions: string[];
  last_checked_at?: string;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function cleanDomain(d: string): string {
  return d.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

export async function optimizeContent(input: {
  keyword: string;
  location?: string;
  draftText?: string;
  targetUrl?: string;
  excludeDomain?: string;
}): Promise<ContentScoreResult> {
  const keyword = input.keyword.trim();
  const empty: ContentScoreResult = {
    available: false,
    data_source: "unavailable",
    keyword,
    competitorsAnalyzed: 0,
    medianWordCount: 0,
    draftWordCount: 0,
    score: 0,
    termTargets: [],
    entityTargets: [],
    headingSuggestions: [],
    paaQuestions: [],
  };
  if (!keyword) return { ...empty, reason: "Keyword required." };

  const serp = await searchGoogleOrganicRouter(keyword, input.location || "United States", input.excludeDomain || "", []);
  if (!serp.success || !serp.data?.organicResults?.length) {
    return { ...empty, reason: serp.error || "No SERP provider configured." };
  }

  // People-Also-Ask extraction is added in Phase 11 (keyword universe).
  const paaQuestions: string[] = [];

  // Scrape the top ranking pages (skip the user's own domain when provided).
  const exclude = input.excludeDomain ? cleanDomain(input.excludeDomain) : "";
  const urls = serp.data.organicResults
    .map((r) => r.url)
    .filter((u) => !exclude || !cleanDomain(u).includes(exclude))
    .slice(0, 10);

  const scraped = await Promise.all(
    urls.map(async (u) => {
      try {
        const r = await scrapePage(u);
        if (r.success && r.data && (r.data.textContent?.length || 0) > 400) return r.data;
      } catch (e) {
        logProviderError("content-optimizer:scrape", e, { url: u });
      }
      return null;
    })
  );
  const pages = scraped.filter((p): p is NonNullable<typeof p> => p != null);

  if (pages.length < 2) {
    return { ...empty, reason: "Could not analyze enough ranking pages (SERP pages blocked scraping)." };
  }

  const wordCounts = pages.map((p) => p.wordCount || 0).filter((n) => n > 0);
  const medianWordCount = median(wordCounts);

  // Document frequency + median in-doc count for each term across competitors.
  const docFreq = new Map<string, number>();
  const inDocCounts = new Map<string, number[]>();
  for (const p of pages) {
    const freq = termFrequencies(p.textContent || "");
    for (const [term, count] of freq) {
      if (count < 2 && !term.includes(" ")) continue; // ignore one-off unigrams
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
      const arr = inDocCounts.get(term) || [];
      arr.push(count);
      inDocCounts.set(term, arr);
    }
  }

  const draftText = input.draftText && input.draftText.trim().length > 0
    ? input.draftText
    : input.targetUrl
      ? (await safeScrapeText(input.targetUrl))
      : "";
  const draftFreq = termFrequencies(draftText);
  const draftWordCount = contentTerms(draftText).length;

  // Important terms: present in >=40% of ranking pages.
  const threshold = Math.max(2, Math.ceil(pages.length * 0.4));
  const termTargets: TermTarget[] = [...docFreq.entries()]
    .filter(([, df]) => df >= threshold)
    .map(([term, df]) => {
      const recommended = median(inDocCounts.get(term) || [1]);
      const inDraft = draftFreq.get(term) || 0;
      const status: TermTarget["status"] =
        inDraft === 0 ? "missing" : inDraft < Math.ceil(recommended * 0.5) ? "underused" : "ok";
      return { term, prevalence: Math.round((df / pages.length) * 100) / 100, recommended, inDraft, status };
    })
    .sort((a, b) => b.prevalence - a.prevalence || b.recommended - a.recommended)
    .slice(0, 40);

  // Entity coverage (NER union across competitors).
  const entityFreq = new Map<string, { type: string; count: number }>();
  for (const p of pages) {
    const ents = entities((p.textContent || "").slice(0, 40_000));
    const seen = new Set<string>();
    for (const e of ents) {
      const key = e.value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const prev = entityFreq.get(key);
      entityFreq.set(key, { type: e.type, count: (prev?.count || 0) + 1 });
    }
  }
  const draftLower = draftText.toLowerCase();
  const entityTargets: EntityTarget[] = [...entityFreq.entries()]
    .filter(([, v]) => v.count >= threshold)
    .map(([entity, v]) => ({
      entity,
      type: v.type,
      prevalence: Math.round((v.count / pages.length) * 100) / 100,
      inDraft: draftLower.includes(entity),
    }))
    .sort((a, b) => b.prevalence - a.prevalence)
    .slice(0, 25);

  // Heading suggestions: most common H2/H3 across competitors.
  const headingFreq = new Map<string, { text: string; count: number }>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const h of p.headings || []) {
      if (h.level < 2 || h.level > 3 || !h.text || h.text.length < 6) continue;
      const norm = h.text.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(norm)) continue;
      seen.add(norm);
      const prev = headingFreq.get(norm);
      headingFreq.set(norm, { text: h.text.trim(), count: (prev?.count || 0) + 1 });
    }
  }
  const headingSuggestions = [...headingFreq.values()]
    .filter((h) => h.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((h) => h.text);

  const score = computeScore({
    draftWordCount,
    medianWordCount,
    termTargets,
    entityTargets,
    headingSuggestions,
    draftProvided: draftText.length > 0,
  });

  return {
    available: true,
    data_source: "measured",
    keyword,
    competitorsAnalyzed: pages.length,
    medianWordCount,
    draftWordCount: draftText ? (draftText.match(/\S+/g) || []).length : 0,
    score,
    termTargets,
    entityTargets,
    headingSuggestions,
    paaQuestions,
    last_checked_at: new Date().toISOString(),
  };
}

async function safeScrapeText(url: string): Promise<string> {
  try {
    const r = await scrapePage(url);
    return r.success && r.data?.textContent ? r.data.textContent : "";
  } catch {
    return "";
  }
}

function computeScore(args: {
  draftWordCount: number;
  medianWordCount: number;
  termTargets: TermTarget[];
  entityTargets: EntityTarget[];
  headingSuggestions: string[];
  draftProvided: boolean;
}): number {
  if (!args.draftProvided) return 0; // No draft to score against; UI shows targets only.

  // Word-count component (0-25): reward reaching ~the median length.
  const wcRatio = args.medianWordCount ? Math.min(1, args.draftWordCount / Math.max(1, args.medianWordCount * 0.8)) : 0.5;
  const wcScore = wcRatio * 25;

  // Term coverage (0-50): fraction of important terms at "ok" status.
  const okTerms = args.termTargets.filter((t) => t.status === "ok").length;
  const termScore = args.termTargets.length ? (okTerms / args.termTargets.length) * 50 : 25;

  // Entity coverage (0-25).
  const coveredEntities = args.entityTargets.filter((e) => e.inDraft).length;
  const entityScore = args.entityTargets.length ? (coveredEntities / args.entityTargets.length) * 25 : 12;

  return Math.max(0, Math.min(100, Math.round(wcScore + termScore + entityScore)));
}
