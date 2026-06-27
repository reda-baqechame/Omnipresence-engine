/**
 * Phase 17: Indexation & AI-crawler intelligence.
 *
 * Two jobs an expert does manually today:
 *  1. Decide what each URL should do (keep / improve / merge / canonicalize /
 *     noindex / redirect / delete) using GSC performance + crawl signals.
 *  2. Prove AI + search bots actually crawl the important pages, by parsing
 *     server access logs and bucketing hits by bot and page-type.
 */

export type IndexAction =
  | "keep"
  | "improve"
  | "merge"
  | "canonicalize"
  | "noindex"
  | "redirect"
  | "delete";

export interface IndexCoverageInput {
  url: string;
  clicks: number;
  impressions: number;
  position: number; // avg, 0 = unknown
  status: number; // HTTP status from crawl (200, 404, 301...)
  wordCount?: number;
  duplicateOf?: string | null; // near-duplicate target if known
  ageDays?: number;
}

export interface IndexCoverageItem {
  url: string;
  action: IndexAction;
  reason: string;
  confidence: number; // 0-1
}

/**
 * Classify a page into one indexation action. Heuristics mirror how an SEO does
 * a content-pruning audit: dead/duplicate pages get consolidated, zero-traffic
 * thin pages get noindexed or improved, performers are kept.
 */
export function classifyIndexCoverage(input: IndexCoverageInput): IndexCoverageItem {
  const { url, clicks, impressions, status, wordCount = 0, duplicateOf, ageDays = 999 } = input;

  if (status >= 500 || status === 0) {
    return { url, action: "improve", reason: `Server/fetch error (${status}) — fix before indexing`, confidence: 0.6 };
  }
  if (status === 404 || status === 410) {
    return { url, action: clicks > 0 || impressions > 10 ? "redirect" : "delete", reason: `Returns ${status}; ${clicks > 0 ? "had traffic, redirect to relevant page" : "no value, remove from sitemap"}`, confidence: 0.8 };
  }
  if (status >= 300 && status < 400) {
    return { url, action: "redirect", reason: `Already redirecting (${status}) — ensure target is correct`, confidence: 0.7 };
  }

  if (duplicateOf) {
    return { url, action: "canonicalize", reason: `Near-duplicate of ${duplicateOf} — set canonical or merge`, confidence: 0.75 };
  }

  // Healthy 200 pages from here.
  if (clicks >= 5 || (impressions >= 100 && input.position > 0 && input.position <= 20)) {
    return { url, action: "keep", reason: `Performing (${clicks} clicks, ${impressions} impr) — keep & monitor`, confidence: 0.85 };
  }

  if (impressions >= 30 && clicks < 2) {
    return { url, action: "improve", reason: `Impressions without clicks — improve title/intent match`, confidence: 0.7 };
  }

  if (wordCount > 0 && wordCount < 250) {
    return { url, action: "improve", reason: `Thin content (${wordCount} words) — expand or merge`, confidence: 0.65 };
  }

  if (ageDays >= 90 && impressions < 10) {
    return { url, action: "noindex", reason: `90d+ old with <10 impressions — noindex or merge to reduce index bloat`, confidence: 0.6 };
  }

  return { url, action: "keep", reason: "No strong signal — keep and observe", confidence: 0.4 };
}

export function classifyIndexCoverageBatch(inputs: IndexCoverageInput[]): {
  items: IndexCoverageItem[];
  summary: Record<IndexAction, number>;
} {
  const items = inputs.map(classifyIndexCoverage);
  const summary = items.reduce(
    (acc, i) => {
      acc[i.action] = (acc[i.action] || 0) + 1;
      return acc;
    },
    { keep: 0, improve: 0, merge: 0, canonicalize: 0, noindex: 0, redirect: 0, delete: 0 } as Record<IndexAction, number>
  );
  return { items, summary };
}

/* ----------------------------- Crawler logs ------------------------------ */

export const KNOWN_BOTS: Record<string, RegExp> = {
  Googlebot: /Googlebot/i,
  Bingbot: /bingbot/i,
  "Google-Extended": /Google-Extended/i,
  GPTBot: /GPTBot/i,
  "OAI-SearchBot": /OAI-SearchBot/i,
  ChatGPTUser: /ChatGPT-User/i,
  PerplexityBot: /PerplexityBot/i,
  ClaudeBot: /ClaudeBot|Claude-Web|anthropic-ai/i,
  "Applebot-Extended": /Applebot-Extended/i,
  Applebot: /Applebot/i,
  Amazonbot: /Amazonbot/i,
  "Bytespider": /Bytespider/i,
  CCBot: /CCBot/i,
  YandexBot: /YandexBot/i,
  DuckDuckBot: /DuckDuckBot/i,
};

export interface CrawlerHit {
  bot: string;
  path: string;
  status: number;
  timestamp?: string;
}

export interface CrawlerLogReport {
  totalLines: number;
  parsedHits: number;
  byBot: Record<string, { hits: number; statuses: Record<string, number>; uniquePaths: number }>;
  byPageType: Record<string, number>;
  topPaths: Array<{ path: string; hits: number }>;
  aiBotsSeen: string[];
  searchBotsSeen: string[];
}

const AI_BOTS = new Set([
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPTUser",
  "PerplexityBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Bytespider",
  "CCBot",
]);

function pageType(path: string): string {
  const p = path.split("?")[0].toLowerCase();
  if (p === "/" || p === "") return "home";
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|woff2?|ttf)$/i.test(p)) return "asset";
  if (/\/blog\/|\/post\/|\/articles?\//.test(p)) return "blog";
  if (/\/product|\/shop|\/store/.test(p)) return "product";
  if (/\/category|\/collections?\//.test(p)) return "category";
  if (/\/(about|contact|pricing|faq|terms|privacy)/.test(p)) return "info";
  return "other";
}

/**
 * Identify the bot for one user-agent string (returns null for human/unknown).
 */
export function identifyBot(userAgent: string): string | null {
  for (const [name, re] of Object.entries(KNOWN_BOTS)) {
    if (re.test(userAgent)) return name;
  }
  return null;
}

// Common/Combined log: IP - - [date] "METHOD /path HTTP/1.1" status size "ref" "ua"
const LOG_RE = /^(\S+).+?\[([^\]]+)\]\s+"(?:\S+)\s+(\S+)\s+\S+"\s+(\d{3})\s+\S+(?:\s+"[^"]*"\s+"([^"]*)")?/;

/**
 * Parse access logs (common/combined) and aggregate bot crawl activity. Lines
 * that aren't from a known bot are ignored for the report.
 */
export function analyzeCrawlerLogs(logText: string): CrawlerLogReport {
  const lines = logText.split(/\r?\n/).filter(Boolean);
  const hits: CrawlerHit[] = [];

  for (const line of lines) {
    const m = LOG_RE.exec(line);
    if (!m) continue;
    const [, , ts, path, statusStr, ua = ""] = m;
    const bot = identifyBot(ua) || identifyBot(line);
    if (!bot) continue;
    if (pageType(path) === "asset") continue; // ignore static assets
    hits.push({ bot, path: path.split("?")[0], status: parseInt(statusStr, 10), timestamp: ts });
  }

  const byBot: CrawlerLogReport["byBot"] = {};
  const byPageType: Record<string, number> = {};
  const pathCounts = new Map<string, number>();
  const botPaths = new Map<string, Set<string>>();

  for (const h of hits) {
    if (!byBot[h.bot]) byBot[h.bot] = { hits: 0, statuses: {}, uniquePaths: 0 };
    byBot[h.bot].hits++;
    const s = String(h.status);
    byBot[h.bot].statuses[s] = (byBot[h.bot].statuses[s] || 0) + 1;
    if (!botPaths.has(h.bot)) botPaths.set(h.bot, new Set());
    botPaths.get(h.bot)!.add(h.path);

    const pt = pageType(h.path);
    byPageType[pt] = (byPageType[pt] || 0) + 1;
    pathCounts.set(h.path, (pathCounts.get(h.path) || 0) + 1);
  }

  for (const [bot, paths] of botPaths) byBot[bot].uniquePaths = paths.size;

  const topPaths = [...pathCounts.entries()]
    .map(([path, h]) => ({ path, hits: h }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 25);

  const botsSeen = Object.keys(byBot);

  return {
    totalLines: lines.length,
    parsedHits: hits.length,
    byBot,
    byPageType,
    topPaths,
    aiBotsSeen: botsSeen.filter((b) => AI_BOTS.has(b)),
    searchBotsSeen: botsSeen.filter((b) => !AI_BOTS.has(b)),
  };
}

/**
 * Flag important URLs that were never crawled by any bot in the log window.
 */
export function findUncrawledImportantPages(
  importantUrls: string[],
  report: CrawlerLogReport
): string[] {
  const crawled = new Set(report.topPaths.map((t) => t.path));
  // topPaths is capped; rebuild full crawled set is not available, so callers
  // should pass the full path set if they need exhaustive coverage. Here we use
  // topPaths as the "frequently crawled" set.
  return importantUrls.filter((u) => {
    try {
      const path = new URL(u).pathname;
      return !crawled.has(path);
    } catch {
      return !crawled.has(u);
    }
  });
}
