/**
 * Agent Analytics engine — turns raw AI crawler hits into the leading-indicator
 * dashboard that tells a brand whether AI engines are actually fetching their
 * content (the prerequisite to being cited). Pairs with the AI visibility
 * scanner: crawls are the input, citations are the output.
 */

import { classifyCrawler, type CrawlerPurpose } from "@/lib/tracking/ai-crawlers";

export interface CrawlerHit {
  bot: string;
  vendor: string;
  purpose: CrawlerPurpose;
  path: string | null;
  status_code: number | null;
  user_agent: string | null;
  hit_at: string;
}

export interface ParsedLogHit {
  bot: string;
  vendor: string;
  purpose: CrawlerPurpose;
  path: string | null;
  statusCode: number | null;
  userAgent: string;
  hitAt: string;
}

export interface BotSummary {
  bot: string;
  vendor: string;
  purpose: CrawlerPurpose;
  hits: number;
  lastSeen: string;
  errorRate: number;
}

export interface AgentAnalyticsSummary {
  totalHits: number;
  uniqueBots: number;
  uniqueVendors: number;
  byBot: BotSummary[];
  byVendor: Array<{ vendor: string; hits: number }>;
  byPurpose: Record<CrawlerPurpose, number>;
  byDay: Array<{ date: string; hits: number }>;
  topPaths: Array<{ path: string; hits: number }>;
  missingVendors: string[];
  windowStart: string | null;
  windowEnd: string | null;
}

/** The AI vendors a healthy, discoverable brand should expect to see crawling. */
const EXPECTED_VENDORS = ["OpenAI", "Anthropic", "Perplexity", "Google"];

/**
 * Parse pasted server/CDN access logs (Apache/Nginx "combined" format, or any
 * line that contains a quoted request and a quoted user-agent) and extract only
 * the AI crawler hits. Keyless: the customer pastes logs, we classify locally.
 *
 * Combined log example:
 *   1.2.3.4 - - [10/Oct/2026:13:55:36 +0000] "GET /pricing HTTP/1.1" 200 512 "-" "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"
 */
export function parseServerLogs(raw: string, maxLines = 50_000): ParsedLogHit[] {
  if (!raw || typeof raw !== "string") return [];
  const lines = raw.split(/\r?\n/).slice(0, maxLines);
  const hits: ParsedLogHit[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    // User-agent is the last quoted field in combined logs.
    const quoted = line.match(/"([^"]*)"/g);
    if (!quoted || quoted.length === 0) continue;
    const userAgent = quoted[quoted.length - 1].replace(/^"|"$/g, "");
    const info = classifyCrawler(userAgent);
    if (!info) continue;

    // Request line is typically the first quoted field: "GET /path HTTP/1.1"
    let path: string | null = null;
    const reqLine = quoted[0].replace(/^"|"$/g, "");
    const reqMatch = reqLine.match(/^[A-Z]+\s+(\S+)\s+HTTP/i);
    if (reqMatch) path = reqMatch[1].slice(0, 500);

    // Status code: first standalone 3-digit number after the request line.
    // Use indexOf (not split) so an empty/odd request field can't shatter the
    // line into characters.
    let statusCode: number | null = null;
    const reqIdx = reqLine ? line.indexOf(reqLine) : -1;
    const afterReq = reqIdx >= 0 ? line.slice(reqIdx + reqLine.length) : line;
    const statusMatch = afterReq.match(/\b([1-5]\d{2})\b/);
    if (statusMatch) statusCode = Number(statusMatch[1]);

    // Timestamp in [dd/Mon/yyyy:HH:MM:SS +ZZZZ] form; fall back to now.
    let hitAt = new Date().toISOString();
    const tsMatch = line.match(/\[(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s[+-]\d{4})\]/);
    if (tsMatch) {
      const parsed = parseClfDate(tsMatch[1]);
      if (parsed) hitAt = parsed;
    }

    hits.push({
      bot: info.bot,
      vendor: info.vendor,
      purpose: info.purpose,
      path,
      statusCode,
      userAgent: userAgent.slice(0, 300),
      hitAt,
    });
  }

  return hits;
}

/** Parse Common Log Format date "10/Oct/2026:13:55:36 +0000" to ISO. */
function parseClfDate(s: string): string | null {
  const m = s.match(/(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s([+-])(\d{2})(\d{2})/);
  if (!m) return null;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const month = months[m[2]];
  if (month === undefined) return null;
  const offsetMin = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  const utc = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offsetMin * 60_000;
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Aggregate stored hits into the dashboard summary. */
export function summarizeCrawlerHits(hits: CrawlerHit[]): AgentAnalyticsSummary {
  const empty: AgentAnalyticsSummary = {
    totalHits: 0,
    uniqueBots: 0,
    uniqueVendors: 0,
    byBot: [],
    byVendor: [],
    byPurpose: { ai_search: 0, ai_training: 0, ai_user_action: 0, search_index: 0 },
    byDay: [],
    topPaths: [],
    missingVendors: [...EXPECTED_VENDORS],
    windowStart: null,
    windowEnd: null,
  };
  if (!hits.length) return empty;

  const botMap = new Map<string, { vendor: string; purpose: CrawlerPurpose; hits: number; lastSeen: string; errors: number }>();
  const vendorMap = new Map<string, number>();
  const purpose: Record<CrawlerPurpose, number> = { ai_search: 0, ai_training: 0, ai_user_action: 0, search_index: 0 };
  const dayMap = new Map<string, number>();
  const pathMap = new Map<string, number>();
  let windowStart = hits[0].hit_at;
  let windowEnd = hits[0].hit_at;

  for (const h of hits) {
    const existing = botMap.get(h.bot);
    const isError = typeof h.status_code === "number" && h.status_code >= 400;
    if (existing) {
      existing.hits += 1;
      if (h.hit_at > existing.lastSeen) existing.lastSeen = h.hit_at;
      if (isError) existing.errors += 1;
    } else {
      botMap.set(h.bot, { vendor: h.vendor, purpose: h.purpose, hits: 1, lastSeen: h.hit_at, errors: isError ? 1 : 0 });
    }

    vendorMap.set(h.vendor, (vendorMap.get(h.vendor) || 0) + 1);
    if (purpose[h.purpose] !== undefined) purpose[h.purpose] += 1;

    const day = h.hit_at.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);

    if (h.path) pathMap.set(h.path, (pathMap.get(h.path) || 0) + 1);

    if (h.hit_at < windowStart) windowStart = h.hit_at;
    if (h.hit_at > windowEnd) windowEnd = h.hit_at;
  }

  const byBot: BotSummary[] = [...botMap.entries()]
    .map(([bot, v]) => ({
      bot,
      vendor: v.vendor,
      purpose: v.purpose,
      hits: v.hits,
      lastSeen: v.lastSeen,
      errorRate: v.hits > 0 ? Math.round((v.errors / v.hits) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.hits - a.hits);

  const byVendor = [...vendorMap.entries()]
    .map(([vendor, h]) => ({ vendor, hits: h }))
    .sort((a, b) => b.hits - a.hits);

  const byDay = [...dayMap.entries()]
    .map(([date, h]) => ({ date, hits: h }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topPaths = [...pathMap.entries()]
    .map(([path, h]) => ({ path, hits: h }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 20);

  const seenVendors = new Set(vendorMap.keys());
  const missingVendors = EXPECTED_VENDORS.filter((v) => !seenVendors.has(v));

  return {
    totalHits: hits.length,
    uniqueBots: botMap.size,
    uniqueVendors: vendorMap.size,
    byBot,
    byVendor,
    byPurpose: purpose,
    byDay,
    topPaths,
    missingVendors,
    windowStart,
    windowEnd,
  };
}
