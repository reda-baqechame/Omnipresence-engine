import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * PostHog — self-hosted, MIT first-party analytics (Phase 9). A GA4-free
 * measured traffic/conversion source: pageviews, unique visitors, and
 * referrer-classified organic/AI/social sessions via HogQL. Degrades to
 * `available:false` when not configured (refund-safety: never a fake zero).
 */

const AI_REFERRER_DOMAINS = [
  "chat.openai.com",
  "chatgpt.com",
  "perplexity.ai",
  "gemini.google.com",
  "claude.ai",
  "copilot.microsoft.com",
  "bing.com/chat",
  "you.com",
];

const SEARCH_REFERRER_DOMAINS = ["google.", "bing.com", "duckduckgo.com", "yahoo.com", "ecosia.org", "brave.com"];
const SOCIAL_REFERRER_DOMAINS = ["facebook.com", "instagram.com", "t.co", "twitter.com", "x.com", "linkedin.com", "reddit.com", "youtube.com", "tiktok.com"];

export interface PostHogConfig {
  apiKey: string;
  projectId: string;
  host: string;
}

export function getPostHogConfig(override?: Partial<PostHogConfig>): PostHogConfig | null {
  const apiKey = override?.apiKey || process.env.POSTHOG_API_KEY;
  const projectId = override?.projectId || process.env.POSTHOG_PROJECT_ID;
  const host = (override?.host || process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  if (!apiKey || apiKey.startsWith("your-") || !projectId) return null;
  return { apiKey, projectId, host };
}

export function hasPostHogCapability(): boolean {
  return getPostHogConfig() != null;
}

async function hogql(cfg: PostHogConfig, query: string): Promise<unknown[][]> {
  const res = await fetchWithTimeout(`${cfg.host}/api/projects/${cfg.projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    timeoutMs: 25_000,
  });
  if (!res.ok) throw Object.assign(new Error(`PostHog ${res.status}`), { status: res.status });
  const data = (await res.json()) as { results?: unknown[][] };
  return data.results || [];
}

export interface PostHogTraffic {
  available: boolean;
  reason?: string;
  visitors: number;
  pageviews: number;
  aiReferrals: number;
  searchVisits: number;
  socialClicks: number;
}

export async function syncPostHog(
  days = 30,
  override?: Partial<PostHogConfig>
): Promise<PostHogTraffic> {
  const cfg = getPostHogConfig(override);
  if (!cfg) {
    return { available: false, reason: "PostHog not configured (POSTHOG_API_KEY/POSTHOG_PROJECT_ID).", visitors: 0, pageviews: 0, aiReferrals: 0, searchVisits: 0, socialClicks: 0 };
  }
  try {
    const interval = `INTERVAL ${Math.max(1, Math.min(365, days))} DAY`;
    const totals = await hogql(
      cfg,
      `SELECT count() AS pv, count(DISTINCT person_id) AS visitors FROM events WHERE event = '$pageview' AND timestamp >= now() - ${interval}`
    );
    const pageviews = Number((totals[0]?.[0] as number) || 0);
    const visitors = Number((totals[0]?.[1] as number) || 0);

    const byReferrer = await hogql(
      cfg,
      `SELECT properties.$referring_domain AS dom, count() AS n FROM events WHERE event = '$pageview' AND timestamp >= now() - ${interval} GROUP BY dom ORDER BY n DESC LIMIT 200`
    );

    let aiReferrals = 0;
    let searchVisits = 0;
    let socialClicks = 0;
    for (const row of byReferrer) {
      const dom = String(row[0] || "").toLowerCase();
      const n = Number(row[1] || 0);
      if (!dom) continue;
      if (AI_REFERRER_DOMAINS.some((d) => dom.includes(d))) aiReferrals += n;
      else if (SEARCH_REFERRER_DOMAINS.some((d) => dom.includes(d))) searchVisits += n;
      else if (SOCIAL_REFERRER_DOMAINS.some((d) => dom.includes(d))) socialClicks += n;
    }

    return { available: true, visitors, pageviews, aiReferrals, searchVisits, socialClicks };
  } catch (error) {
    logProviderError("posthog", error, { projectId: cfg.projectId });
    return { available: false, reason: error instanceof Error ? error.message : "PostHog failed", visitors: 0, pageviews: 0, aiReferrals: 0, searchVisits: 0, socialClicks: 0 };
  }
}
