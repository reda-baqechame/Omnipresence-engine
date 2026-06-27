import { getKeywordTrends } from "@/lib/providers/google-trends";
import { getKeywordSuggestionsSerper } from "@/lib/providers/serper-keywords";
import { searchRedditViaSerp, searchHackerNewsMentions } from "@/lib/engines/community-mentions";

/**
 * Phase 20: Demand & trend discovery.
 *
 * Catches rising demand before competitors by fusing three free signals:
 *  - Google Trends momentum + rising related queries (relative interest)
 *  - Google autocomplete expansion (what people type now)
 *  - Community velocity (Reddit + Hacker News mention counts)
 * Plus seasonality from the 12-month trend timeline and intent clustering.
 */

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";

export interface RisingTopic {
  topic: string;
  source: "trends_rising" | "autocomplete" | "community";
  momentum: number; // -100..100 (trend), or velocity proxy
  communityHits: number;
  createNow: boolean;
  intent: SearchIntent;
}

export function classifyIntent(keyword: string): SearchIntent {
  const k = keyword.toLowerCase();
  if (/\b(buy|price|pricing|cost|coupon|deal|order|cheap|discount|free trial|signup|sign up)\b/.test(k)) return "transactional";
  if (/\b(best|top|review|reviews|vs|versus|compare|comparison|alternative|alternatives|software|tool|tools|services?)\b/.test(k)) return "commercial";
  if (/\b(login|sign in|download|app|dashboard|account)\b/.test(k)) return "navigational";
  return "informational";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface Seasonality {
  available: boolean;
  peakMonths: string[];
  lowMonths: string[];
}

function computeSeasonality(timeline: Array<{ date: string; value: number }>): Seasonality {
  if (timeline.length < 6) return { available: false, peakMonths: [], lowMonths: [] };
  const monthly = new Map<number, { sum: number; n: number }>();
  for (const p of timeline) {
    const d = new Date(p.date);
    const m = isNaN(d.getTime()) ? -1 : d.getMonth();
    if (m < 0) continue;
    const cur = monthly.get(m) || { sum: 0, n: 0 };
    cur.sum += p.value;
    cur.n += 1;
    monthly.set(m, cur);
  }
  const avgs = [...monthly.entries()].map(([m, v]) => ({ m, avg: v.sum / Math.max(v.n, 1) }));
  if (avgs.length < 4) return { available: false, peakMonths: [], lowMonths: [] };
  const overall = avgs.reduce((s, a) => s + a.avg, 0) / avgs.length;
  const peaks = avgs.filter((a) => a.avg >= overall * 1.2).map((a) => MONTHS[a.m]);
  const lows = avgs.filter((a) => a.avg <= overall * 0.8).map((a) => MONTHS[a.m]);
  return { available: peaks.length > 0 || lows.length > 0, peakMonths: peaks, lowMonths: lows };
}

async function communityVelocity(topic: string): Promise<number> {
  try {
    const [reddit, hn] = await Promise.all([
      searchRedditViaSerp(topic).catch(() => []),
      searchHackerNewsMentions(topic).catch(() => []),
    ]);
    return reddit.length + hn.length;
  } catch {
    return 0;
  }
}

/**
 * Discover rising topics for a seed/industry. Returns scored topics with a
 * "create now" flag (high momentum or strong community velocity).
 */
export async function discoverRisingTopics(input: {
  seed: string;
  geo?: string;
  includeCommunity?: boolean;
}): Promise<{ rising: RisingTopic[]; seasonality: Seasonality; seedMomentum: number; available: boolean }> {
  const geo = input.geo || "US";
  const trends = await getKeywordTrends(input.seed, geo);
  const seasonality = computeSeasonality(trends.timeline);

  const candidates = new Map<string, RisingTopic>();

  // Trends rising related queries — strongest "before competitors" signal.
  for (const q of trends.related_rising || []) {
    candidates.set(q.toLowerCase(), {
      topic: q,
      source: "trends_rising",
      momentum: Math.max(trends.momentum, 40),
      communityHits: 0,
      createNow: true,
      intent: classifyIntent(q),
    });
  }

  // Autocomplete expansion.
  const auto = await getKeywordSuggestionsSerper(input.seed).catch(() => null);
  for (const s of auto?.suggestions || []) {
    const key = s.keyword.toLowerCase();
    if (!candidates.has(key)) {
      candidates.set(key, {
        topic: s.keyword,
        source: "autocomplete",
        momentum: trends.momentum,
        communityHits: 0,
        createNow: false,
        intent: classifyIntent(s.keyword),
      });
    }
  }

  // Community velocity for the top candidates (bounded to keep it fast).
  if (input.includeCommunity !== false) {
    const top = [...candidates.values()].slice(0, 8);
    await Promise.all(
      top.map(async (t) => {
        const hits = await communityVelocity(t.topic);
        t.communityHits = hits;
        if (hits >= 3) t.createNow = true;
      })
    );
  }

  const rising = [...candidates.values()].sort((a, b) => {
    const sa = a.momentum + a.communityHits * 5 + (a.createNow ? 30 : 0);
    const sb = b.momentum + b.communityHits * 5 + (b.createNow ? 30 : 0);
    return sb - sa;
  });

  return {
    rising,
    seasonality,
    seedMomentum: trends.momentum,
    available: rising.length > 0 || trends.available,
  };
}

export interface IntentCluster {
  intent: SearchIntent;
  keywords: string[];
}

/**
 * Cluster keywords by intent (feeds the topical architecture in Phase 15).
 * Lightweight, deterministic grouping — no API calls.
 */
export function clusterKeywordsByIntent(keywords: string[]): IntentCluster[] {
  const groups = new Map<SearchIntent, string[]>();
  for (const k of [...new Set(keywords)]) {
    const intent = classifyIntent(k);
    if (!groups.has(intent)) groups.set(intent, []);
    groups.get(intent)!.push(k);
  }
  return [...groups.entries()].map(([intent, kws]) => ({ intent, keywords: kws }));
}
