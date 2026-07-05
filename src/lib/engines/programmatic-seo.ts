import type { ContentAssetType } from "@/types/database";

/** Hard ceiling for a single programmatic campaign (10k-row matrices). */
export const PSEO_MAX_PAGES = 10000;

export type PseoTemplateType = "location_page" | "service_page" | "best_of_page" | "comparison_page";

export interface PseoCampaignInput {
  name: string;
  templateType: PseoTemplateType;
  urlPattern?: string;
  services: string[];
  locations: string[];
  keywords?: string[];
  maxPages?: number;
}

export interface PseoPageSpec {
  topic: string;
  slug: string;
  url: string;
  type: ContentAssetType;
  metadata: Record<string, unknown>;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function applyUrlPattern(pattern: string, vars: Record<string, string>): string {
  let url = pattern;
  for (const [key, value] of Object.entries(vars)) {
    url = url.replace(new RegExp(`\\{${key}\\}`, "g"), slugify(value));
  }
  return url.replace(/\/+/g, "/");
}

function buildTopic(
  templateType: PseoTemplateType,
  service: string,
  location: string,
  keyword?: string
): string {
  switch (templateType) {
    case "location_page":
      return `${service} in ${location}`;
    case "service_page":
      return keyword ? `${keyword} — ${service}` : service;
    case "best_of_page":
      return `Best ${service} in ${location}`;
    case "comparison_page":
      return `${service} options in ${location}: comparison guide`;
    default:
      return `${service} ${location}`;
  }
}

/**
 * Expand keyword × location × service matrix into page specs.
 * Caps at maxPages to prevent runaway generation.
 */
export function expandPseoMatrix(
  input: PseoCampaignInput,
  domain: string,
  evidence?: Map<string, { demandIndex: number; confidence: string }>
): PseoPageSpec[] {
  const maxPages = Math.min(input.maxPages ?? 50, PSEO_MAX_PAGES);
  const pattern = input.urlPattern || "/{type}/{slug}";
  const services = input.services.length ? input.services : ["services"];
  const locations = input.locations.length ? input.locations : ["local"];
  const keywords = input.keywords?.length ? input.keywords : [];
  const specs: PseoPageSpec[] = [];
  const seen = new Set<string>();

  const typeMap: Record<PseoTemplateType, ContentAssetType> = {
    location_page: "location_page",
    service_page: "service_page",
    best_of_page: "best_of_page",
    comparison_page: "comparison_page",
  };
  const contentType = typeMap[input.templateType];

  for (const service of services) {
    for (const location of locations) {
      const keywordList = keywords.length ? keywords : [""];
      for (const keyword of keywordList) {
        if (specs.length >= maxPages) return specs;

        const topic = buildTopic(input.templateType, service, location, keyword || undefined);
        const evidenceKey = keyword || `${service} ${location}`;
        const ev = evidence?.get(evidenceKey.toLowerCase());
        if (evidence && ev && ev.demandIndex < 15 && ev.confidence === "low") continue;
        const slug = slugify(
          keyword ? `${keyword}-${service}-${location}` : `${service}-${location}`
        );
        if (seen.has(slug)) continue;
        seen.add(slug);

        const path = applyUrlPattern(pattern, {
          type: input.templateType.replace("_page", ""),
          slug,
          service: slugify(service),
          location: slugify(location),
          keyword: keyword ? slugify(keyword) : "",
        });

        const base = domain.startsWith("http") ? domain : `https://${domain}`;
        const url = new URL(path.startsWith("/") ? path : `/${path}`, base).toString();

        specs.push({
          topic,
          slug,
          url,
          type: contentType,
          metadata: {
            service,
            location,
            keyword: keyword || null,
            template_type: input.templateType,
            programmatic: true,
          },
        });
      }
    }
  }

  return specs;
}

/** Count matrix cells before evidence gate (for skipped reporting). */
export function countPseoMatrixCells(input: PseoCampaignInput): number {
  const services = Math.max(input.services.length, 1);
  const locations = Math.max(input.locations.length, 1);
  const keywords = input.keywords?.length ? input.keywords.length : 1;
  return Math.min(
    services * locations * keywords,
    Math.min(input.maxPages ?? 50, PSEO_MAX_PAGES)
  );
}

export interface PseoEvidenceEntry {
  demandIndex: number;
  confidence: string;
  method: "keyword_opportunity" | "prompt_demand" | "unavailable";
}

/**
 * Build query-demand evidence for pSEO matrix gating from stored keyword
 * opportunities + optional live prompt-demand for top cells.
 */
export async function buildPseoEvidenceMap(
  keywords: string[],
  stored?: Array<{
    keyword: string;
    trend_index?: number | null;
    volume_confidence?: string | null;
    opportunity_score?: number | null;
  }>
): Promise<Map<string, PseoEvidenceEntry>> {
  const map = new Map<string, PseoEvidenceEntry>();
  for (const row of stored || []) {
    const k = row.keyword.trim().toLowerCase();
    if (!k) continue;
    const trend = typeof row.trend_index === "number" ? row.trend_index : 0;
    const opp = typeof row.opportunity_score === "number" ? row.opportunity_score : 0;
    const demandIndex = Math.round(trend * 0.6 + Math.min(100, opp) * 0.4);
    map.set(k, {
      demandIndex,
      confidence: row.volume_confidence || (trend > 0 ? "medium" : "low"),
      method: "keyword_opportunity",
    });
  }

  const missing = keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k && !map.has(k))
    .slice(0, 8);

  if (missing.length) {
    const { measurePromptDemandBatch } = await import("@/lib/engines/prompt-demand");
    const signals = await measurePromptDemandBatch(missing, { max: missing.length });
    for (const s of signals) {
      map.set(s.prompt.toLowerCase(), {
        demandIndex: s.demandIndex,
        confidence: s.confidence,
        method: "prompt_demand",
      });
    }
  }

  return map;
}

export function estimatePseoMatrixSize(input: PseoCampaignInput): number {
  const services = Math.max(input.services.length, 1);
  const locations = Math.max(input.locations.length, 1);
  const keywords = input.keywords?.length ? input.keywords.length : 1;
  return Math.min(services * locations * keywords, Math.min(input.maxPages ?? 50, PSEO_MAX_PAGES));
}

/** Per-page Search Console performance (from searchAnalytics with dimensions=["page"]). */
export interface PseoPagePerformance {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PseoRefreshCandidate {
  url: string;
  reason: string;
  priority: number;
  clicks: number;
  impressions: number;
  position: number;
}

/** Expected organic CTR by average position (industry curve, approximate). */
function expectedCtr(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.1;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.025;
  return 0.01;
}

/**
 * GSC refresh loop: scan real per-page Search Console performance and flag
 * programmatic pages worth refreshing — striking-distance pages, high-impression
 * low-CTR pages, and high-impression zero-click pages. Sorted by opportunity.
 */
export function selectPagesToRefresh(
  rows: PseoPagePerformance[],
  opts: { minImpressions?: number } = {}
): PseoRefreshCandidate[] {
  const minImpressions = opts.minImpressions ?? 50;
  const candidates: PseoRefreshCandidate[] = [];

  for (const r of rows) {
    if (r.impressions < minImpressions) continue;
    const reasons: string[] = [];
    let priority = 0;

    // Striking distance — small push can win page-1 / AI-citation eligibility.
    if (r.position > 7 && r.position <= 20) {
      reasons.push(`striking distance (avg position ${r.position.toFixed(1)})`);
      priority += r.impressions * 0.5;
    }

    // High impressions but CTR well below expectation for its position.
    const target = expectedCtr(r.position);
    if (r.ctr < target * 0.5) {
      reasons.push(
        `low CTR ${(r.ctr * 100).toFixed(1)}% vs ~${(target * 100).toFixed(0)}% expected`
      );
      priority += r.impressions * 0.3;
    }

    // Lots of impressions, no clicks — title/meta or intent mismatch.
    if (r.clicks === 0 && r.impressions >= minImpressions * 2) {
      reasons.push("high impressions, zero clicks");
      priority += r.impressions * 0.4;
    }

    if (reasons.length) {
      candidates.push({
        url: r.url,
        reason: reasons.join("; "),
        priority: Math.round(priority),
        clicks: r.clicks,
        impressions: r.impressions,
        position: Math.round(r.position * 10) / 10,
      });
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority);
}

/* ----------------------------------------------------------------------------
 * Phase 16: Anti-thin-content guardrails + gradual indexation
 * Programmatic pages only help if each one carries unique value. These checks
 * run BEFORE publish so we never ship spammy doorway pages (refund + penalty
 * risk). A page must clear a quality bar; otherwise it is held for revision.
 * -------------------------------------------------------------------------- */

export interface ContentQualityChecks {
  wordCount: number;
  hasTable: boolean;
  hasList: boolean;
  internalLinkCount: number;
  hasSchema: boolean;
  dataPointCount: number; // numbers/statistics that signal substance
  uniquenessRatio: number; // 0-1 vs the rest of the batch (1 = fully unique)
}

export interface ContentQualityVerdict {
  score: number; // 0-100
  verdict: "publish" | "revise" | "reject";
  checks: ContentQualityChecks;
  issues: string[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "is", "are", "be", "this", "that", "it", "as", "by", "from", "your",
]);

function shingleSet(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  const shingles = new Set<string>();
  for (let i = 0; i < tokens.length - 2; i++) {
    shingles.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return shingles;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Score one page's content against thin-content heuristics. `peers` are other
 * page bodies in the same batch used to measure near-duplication (the #1
 * programmatic failure mode).
 */
export function assessContentQuality(
  body: string,
  opts: { peers?: string[]; minWords?: number } = {}
): ContentQualityVerdict {
  const minWords = opts.minWords ?? 350;
  const plain = body.replace(/<[^>]+>/g, " ");
  const wordCount = plain.split(/\s+/).filter(Boolean).length;
  const hasTable = /<table|\|.*\|.*\|/.test(body);
  const hasList = /<(ul|ol)|^\s*[-*]\s+|^\s*\d+\.\s+/m.test(body);
  const internalLinkCount = (body.match(/<a\s[^>]*href|\]\(/gi) || []).length;
  const hasSchema = /application\/ld\+json|"@context"/.test(body);
  const dataPointCount = (plain.match(/\b\d[\d,.]*\s?(%|percent|\$|usd|hours?|days?|years?|x\b)/gi) || []).length;

  let uniquenessRatio = 1;
  if (opts.peers && opts.peers.length) {
    const me = shingleSet(plain);
    let maxSim = 0;
    for (const p of opts.peers) {
      maxSim = Math.max(maxSim, jaccard(me, shingleSet(p.replace(/<[^>]+>/g, " "))));
    }
    uniquenessRatio = Math.max(0, 1 - maxSim);
  }

  const checks: ContentQualityChecks = {
    wordCount,
    hasTable,
    hasList,
    internalLinkCount,
    hasSchema,
    dataPointCount,
    uniquenessRatio: Math.round(uniquenessRatio * 100) / 100,
  };

  const issues: string[] = [];
  let score = 0;

  if (wordCount >= minWords) score += 25;
  else issues.push(`Thin: ${wordCount} words (< ${minWords})`);

  if (uniquenessRatio >= 0.7) score += 25;
  else issues.push(`Near-duplicate of sibling pages (uniqueness ${(uniquenessRatio * 100).toFixed(0)}%)`);

  if (hasTable || hasList) score += 15;
  else issues.push("No table or list — add structured value");

  if (internalLinkCount >= 2) score += 15;
  else issues.push("Fewer than 2 internal links");

  if (dataPointCount >= 2) score += 10;
  else issues.push("Few concrete data points / statistics");

  if (hasSchema) score += 10;
  else issues.push("No structured data (JSON-LD)");

  const verdict: ContentQualityVerdict["verdict"] =
    score >= 70 ? "publish" : score >= 45 ? "revise" : "reject";

  return { score, verdict, checks, issues };
}

export interface IndexationBatch {
  day: number;
  urls: string[];
}

/**
 * Gradual indexation plan: drip pages out over time instead of dumping
 * thousands at once (which trips spam detection). Returns daily batches.
 */
export function planGradualIndexation(
  urls: string[],
  opts: { perDay?: number; startDay?: number } = {}
): IndexationBatch[] {
  const perDay = Math.max(1, opts.perDay ?? 20);
  const startDay = opts.startDay ?? 1;
  const batches: IndexationBatch[] = [];
  for (let i = 0; i < urls.length; i += perDay) {
    batches.push({ day: startDay + i / perDay, urls: urls.slice(i, i + perDay) });
  }
  return batches;
}

export interface LowPerformer {
  url: string;
  reason: string;
  clicks: number;
  impressions: number;
  ageDays: number;
}

/**
 * Identify programmatic pages to kill/noindex: after a grace period, pages with
 * negligible impressions/clicks are dead weight that dilutes site quality.
 */
export function selectLowPerformersToKill(
  rows: Array<PseoPagePerformance & { ageDays: number }>,
  opts: { graceDays?: number; minImpressions?: number; minClicks?: number } = {}
): LowPerformer[] {
  const graceDays = opts.graceDays ?? 90;
  const minImpressions = opts.minImpressions ?? 20;
  const minClicks = opts.minClicks ?? 1;
  const kill: LowPerformer[] = [];

  for (const r of rows) {
    if (r.ageDays < graceDays) continue;
    if (r.impressions < minImpressions) {
      kill.push({ url: r.url, reason: `Only ${r.impressions} impressions in ${r.ageDays}d`, clicks: r.clicks, impressions: r.impressions, ageDays: r.ageDays });
    } else if (r.clicks < minClicks) {
      kill.push({ url: r.url, reason: `${r.impressions} impressions but ${r.clicks} clicks in ${r.ageDays}d`, clicks: r.clicks, impressions: r.impressions, ageDays: r.ageDays });
    }
  }

  return kill;
}

export function parseCsvLines(csv: string): string[] {
  return csv
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse matrix rows: service,location[,keyword] per line (header optional). */
export function parsePseoMatrixCsv(csv: string): {
  services: string[];
  locations: string[];
  keywords: string[];
} {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { services: [], locations: [], keywords: [] };

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("service") || header.includes("location");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const services = new Set<string>();
  const locations = new Set<string>();
  const keywords = new Set<string>();

  for (const line of dataLines) {
    const parts = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    const service = parts[0];
    const location = parts[1];
    const keyword = parts[2];
    if (service) services.add(service);
    if (location) locations.add(location);
    if (keyword) keywords.add(keyword);
  }

  return {
    services: [...services],
    locations: [...locations],
    keywords: [...keywords],
  };
}
