import { searchGoogleOrganicRouter } from "@/lib/providers/serp-router";
import { logProviderError } from "@/lib/observability/log";

export interface CommunityMentionRow {
  platform: "reddit" | "quora" | "hacker_news" | "github" | "other";
  url: string;
  keyword?: string;
  mention_type?: "brand" | "competitor" | "category";
  competitor?: string;
  title?: string;
  /** "live" = fetched from a real API/SERP; "import" = user CSV upload. */
  source?: "live" | "import";
}

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const REDDIT_USER_AGENT =
  process.env.REDDIT_USER_AGENT || "web:omnipresence-engine:v1.0 (by /u/omnipresence)";

export function hasRedditApi(): boolean {
  return Boolean(REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET);
}

let redditToken: { value: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string | null> {
  if (redditToken && redditToken.expiresAt > Date.now() + 30_000) return redditToken.value;
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  try {
    const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": REDDIT_USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    redditToken = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return redditToken.value;
  } catch (error) {
    logProviderError("community.reddit.token", error);
    return null;
  }
}

/** Real Reddit mention search via the official API (read-only OAuth). */
export async function searchRedditMentions(
  query: string,
  limit = 25
): Promise<CommunityMentionRow[]> {
  const token = await getRedditToken();
  if (!token) return [];
  try {
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(
      query
    )}&limit=${limit}&sort=relevance&type=link`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": REDDIT_USER_AGENT },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { children?: Array<{ data?: { permalink?: string; title?: string } }> };
    };
    return (data.data?.children || [])
      .map((c) => c.data)
      .filter((d): d is { permalink?: string; title?: string } => Boolean(d?.permalink))
      .map((d) => ({
        platform: "reddit" as const,
        url: `https://www.reddit.com${d.permalink}`,
        title: d.title,
        keyword: query,
        mention_type: "brand" as const,
        source: "live" as const,
      }));
  } catch (error) {
    logProviderError("community.reddit.search", error, { query });
    return [];
  }
}

/** Keyless Reddit discovery via `site:reddit.com` SERP (OmniData/Serper/Brave). */
export async function searchRedditViaSerp(query: string): Promise<CommunityMentionRow[]> {
  try {
    const res = await searchGoogleOrganicRouter(
      `site:reddit.com ${query}`,
      "United States",
      "",
      []
    );
    if (!res.success || !res.data) return [];
    return res.data.organicResults
      .filter((r) => r.url.includes("reddit.com/r/"))
      .slice(0, 15)
      .map((r) => ({
        platform: "reddit" as const,
        url: r.url,
        title: r.title,
        keyword: query,
        mention_type: "brand" as const,
        source: "live" as const,
      }));
  } catch (error) {
    logProviderError("community.reddit.serp", error, { query });
    return [];
  }
}

/** Real Hacker News mentions via the keyless Algolia HN Search API. */
export async function searchHackerNewsMentions(query: string): Promise<CommunityMentionRow[]> {
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`,
      { headers: { connection: "close" }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hits?: Array<{ objectID?: string; title?: string; url?: string; story_text?: string }>;
    };
    return (data.hits || [])
      .filter((h) => h.objectID && (h.title || h.url))
      .slice(0, 15)
      .map((h) => ({
        platform: "hacker_news" as const,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: h.title,
        keyword: query,
        mention_type: "brand" as const,
        source: "live" as const,
      }));
  } catch (error) {
    logProviderError("community.hackernews.search", error, { query });
    return [];
  }
}

/** Best-effort Quora mention discovery via `site:quora.com` SERP. */
export async function searchQuoraMentions(query: string): Promise<CommunityMentionRow[]> {
  try {
    const res = await searchGoogleOrganicRouter(
      `site:quora.com ${query}`,
      "United States",
      "",
      []
    );
    if (!res.success || !res.data) return [];
    return res.data.organicResults
      .filter((r) => r.url.includes("quora.com"))
      .slice(0, 15)
      .map((r) => ({
        platform: "quora" as const,
        url: r.url,
        title: r.title,
        keyword: query,
        mention_type: "brand" as const,
        source: "live" as const,
      }));
  } catch (error) {
    logProviderError("community.quora.serp", error, { query });
    return [];
  }
}

/** Aggregate real community mentions for a brand + competitors across Reddit/Quora. */
export async function fetchLiveCommunityMentions(
  brand: string,
  competitors: string[] = []
): Promise<{ rows: CommunityMentionRow[]; redditAvailable: boolean }> {
  const queries = [brand, ...competitors.slice(0, 3)].filter(Boolean);
  const redditAvailable = hasRedditApi();

  // Use the official Reddit API when registered; otherwise fall back to a
  // keyless `site:reddit.com` SERP query (OmniData/Serper/Brave).
  const redditSearch = redditAvailable ? searchRedditMentions : searchRedditViaSerp;

  const results = await Promise.all(
    queries.flatMap((q) => [redditSearch(q), searchQuoraMentions(q), searchHackerNewsMentions(q)])
  );

  const rows: CommunityMentionRow[] = [];
  const seen = new Set<string>();
  for (const list of results) {
    for (const row of list) {
      if (seen.has(row.url)) continue;
      seen.add(row.url);
      const isCompetitor = competitors.some(
        (c) => `${row.url} ${row.title || ""}`.toLowerCase().includes(c.toLowerCase())
      );
      rows.push({
        ...row,
        mention_type: isCompetitor ? "competitor" : "brand",
        competitor: isCompetitor
          ? competitors.find((c) =>
              `${row.url} ${row.title || ""}`.toLowerCase().includes(c.toLowerCase())
            )
          : undefined,
      });
    }
  }
  return { rows, redditAvailable };
}

export function parseMentionsCsv(csv: string): CommunityMentionRow[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const urlIdx = header.findIndex((h) => h.includes("url"));
  const platformIdx = header.findIndex((h) => h.includes("platform"));
  const kwIdx = header.findIndex((h) => h.includes("keyword"));

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const url = cols[urlIdx >= 0 ? urlIdx : 0] || "";
    let platform: CommunityMentionRow["platform"] = "other";
    const p = (cols[platformIdx >= 0 ? platformIdx : 1] || "").toLowerCase();
    if (p.includes("reddit")) platform = "reddit";
    else if (p.includes("quora")) platform = "quora";
    else if (p.includes("hacker") || p.includes("hn")) platform = "hacker_news";
    else if (p.includes("github")) platform = "github";
    else if (url.includes("reddit.com")) platform = "reddit";
    else if (url.includes("quora.com")) platform = "quora";
    else if (url.includes("ycombinator.com")) platform = "hacker_news";
    else if (url.includes("github.com")) platform = "github";

    return {
      platform,
      url,
      keyword: kwIdx >= 0 ? cols[kwIdx] : undefined,
      mention_type: "brand" as const,
      source: "import" as const,
    };
  }).filter((r) => r.url.startsWith("http"));
}

export function summarizeMentions(
  rows: CommunityMentionRow[],
  brand: string,
  competitors: string[]
): {
  total: number;
  byPlatform: Record<string, number>;
  brandMentions: number;
  competitorMentions: number;
  coverageScore: number;
} {
  const byPlatform: Record<string, number> = {};
  let brandMentions = 0;
  let competitorMentions = 0;

  for (const r of rows) {
    byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1;
    const text = `${r.url} ${r.keyword || ""}`.toLowerCase();
    if (text.includes(brand.toLowerCase())) brandMentions++;
    for (const c of competitors) {
      if (text.includes(c.toLowerCase())) competitorMentions++;
    }
  }

  const coverageScore = rows.length
    ? Math.min(100, Math.round((brandMentions / Math.max(rows.length, 1)) * 100))
    : 0;

  return {
    total: rows.length,
    byPlatform,
    brandMentions,
    competitorMentions,
    coverageScore,
  };
}
