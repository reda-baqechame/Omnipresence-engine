import { fetchWithTimeout } from "../http";
import { logProviderError } from "@/lib/observability/log";

/**
 * Social & community mention firehose providers (Phase 14).
 * All free/keyless or free-token. Each returns a normalized mention list and
 * degrades to [] independently — never throws, never fabricates.
 */

export interface SocialMention {
  platform: "stackexchange" | "producthunt" | "github" | "mastodon" | "bluesky" | "wikipedia";
  url: string;
  title: string;
  snippet?: string;
  createdAt?: string;
}

const UA = "OmniPresence-Mentions/1.0 (https://github.com)";

/** Alphanumeric-normalized token (handles spacing/punctuation differences). */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Relevance guard: keep a result only when the brand/competitor query actually
 * appears in the candidate text. Prevents counting brand-irrelevant noise
 * (e.g. linear-algebra repos for the brand "Linear") as real mentions. Skips
 * filtering for tokens too short to disambiguate.
 */
function matchesQuery(text: string, query: string): boolean {
  const q = norm(query);
  if (q.length < 3) return true;
  return norm(text).includes(q);
}

// ---------- Stack Exchange (keyless; optional key for higher quota) ----------
export async function searchStackExchange(query: string, site = "stackoverflow"): Promise<SocialMention[]> {
  try {
    const key = process.env.STACKEXCHANGE_KEY;
    const params = new URLSearchParams({
      order: "desc",
      sort: "relevance",
      q: query,
      site,
      pagesize: "15",
      filter: "withbody",
    });
    if (key && !key.startsWith("your-")) params.set("key", key);
    const res = await fetchWithTimeout(`https://api.stackexchange.com/2.3/search/advanced?${params}`, {
      headers: { "User-Agent": UA },
      timeoutMs: 12_000,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ link?: string; title?: string; creation_date?: number }> };
    return (data.items || [])
      .filter((i) => i.link)
      .map((i) => ({
        platform: "stackexchange" as const,
        url: i.link!,
        title: decodeHtml(i.title || ""),
        createdAt: i.creation_date ? new Date(i.creation_date * 1000).toISOString() : undefined,
      }));
  } catch (error) {
    logProviderError("mentions.stackexchange", error, { query });
    return [];
  }
}

// ---------- GitHub (keyless low quota; GITHUB_TOKEN for higher) ----------
export async function searchGitHub(query: string): Promise<SocialMention[]> {
  try {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/vnd.github+json" };
    const token = process.env.GITHUB_TOKEN;
    if (token && !token.startsWith("your-")) headers.Authorization = `Bearer ${token}`;
    const res = await fetchWithTimeout(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=15`,
      { headers, timeoutMs: 12_000 }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ html_url?: string; full_name?: string; description?: string; created_at?: string }> };
    return (data.items || [])
      .filter((i) => i.html_url)
      .filter((i) => matchesQuery(`${i.full_name || ""} ${i.description || ""}`, query))
      .map((i) => ({
        platform: "github" as const,
        url: i.html_url!,
        title: i.full_name || "",
        snippet: i.description || undefined,
        createdAt: i.created_at,
      }));
  } catch (error) {
    logProviderError("mentions.github", error, { query });
    return [];
  }
}

// ---------- Product Hunt (requires free developer token) ----------
export async function searchProductHunt(query: string): Promise<SocialMention[]> {
  const token = process.env.PRODUCTHUNT_TOKEN;
  if (!token || token.startsWith("your-")) return [];
  try {
    // Product Hunt's public GraphQL has no full-text post search, so we pull a
    // window of recent posts and match the brand client-side. NOTE: the query
    // must NOT declare an unused $q variable — GraphQL's NoUnusedVariables rule
    // rejects that, which previously made this provider always error out.
    const gql = `query{ posts(first:20, order:NEWEST){ edges{ node{ name tagline url createdAt } } } }`;
    const res = await fetchWithTimeout("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ query: gql }),
      timeoutMs: 15_000,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { posts?: { edges?: Array<{ node?: { name?: string; tagline?: string; url?: string; createdAt?: string } }> } };
    };
    return (data.data?.posts?.edges || [])
      .map((e) => e.node)
      .filter((n): n is { name?: string; tagline?: string; url?: string; createdAt?: string } => Boolean(n?.url))
      .filter((n) => matchesQuery(`${n.name || ""} ${n.tagline || ""}`, query))
      .map((n) => ({
        platform: "producthunt" as const,
        url: n.url!,
        title: n.name || "",
        snippet: n.tagline,
        createdAt: n.createdAt,
      }));
  } catch (error) {
    logProviderError("mentions.producthunt", error, { query });
    return [];
  }
}

// ---------- Mastodon (keyless hashtag timeline on mastodon.social) ----------
export async function searchMastodon(query: string): Promise<SocialMention[]> {
  try {
    const instance = (process.env.MASTODON_INSTANCE || "https://mastodon.social").replace(/\/+$/, "");
    const tag = query.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (!tag) return [];
    const res = await fetchWithTimeout(`${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=15`, {
      headers: { "User-Agent": UA },
      timeoutMs: 12_000,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ url?: string; content?: string; created_at?: string; account?: { acct?: string } }>;
    return (data || [])
      .filter((s) => s.url)
      // Hashtag timelines collide on common words (e.g. #linear); keep posts
      // whose text actually contains the brand to cut topic-collision noise.
      .filter((s) => matchesQuery(`${s.account?.acct || ""} ${stripHtml(s.content || "")}`, query))
      .map((s) => ({
        platform: "mastodon" as const,
        url: s.url!,
        title: s.account?.acct ? `@${s.account.acct}` : "Mastodon post",
        snippet: stripHtml(s.content || "").slice(0, 200),
        createdAt: s.created_at,
      }));
  } catch (error) {
    logProviderError("mentions.mastodon", error, { query });
    return [];
  }
}

// ---------- Bluesky (keyless public AppView API) ----------
export async function searchBluesky(query: string): Promise<SocialMention[]> {
  try {
    const res = await fetchWithTimeout(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=15`,
      { headers: { "User-Agent": UA }, timeoutMs: 12_000 }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      posts?: Array<{ uri?: string; author?: { handle?: string }; record?: { text?: string; createdAt?: string } }>;
    };
    return (data.posts || [])
      .filter((p) => p.uri && p.author?.handle)
      .map((p) => {
        const rkey = (p.uri || "").split("/").pop();
        return {
          platform: "bluesky" as const,
          url: `https://bsky.app/profile/${p.author!.handle}/post/${rkey}`,
          title: `@${p.author!.handle}`,
          snippet: (p.record?.text || "").slice(0, 200),
          createdAt: p.record?.createdAt,
        };
      });
  } catch (error) {
    logProviderError("mentions.bluesky", error, { query });
    return [];
  }
}

// ---------- Wikipedia (keyless search; entity signal) ----------
export async function searchWikipedia(query: string): Promise<SocialMention[]> {
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: "10",
      format: "json",
      origin: "*",
    });
    const res = await fetchWithTimeout(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { "User-Agent": UA },
      timeoutMs: 12_000,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
    return (data.query?.search || [])
      .filter((s) => s.title)
      .map((s) => ({
        platform: "wikipedia" as const,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent((s.title || "").replace(/\s+/g, "_"))}`,
        title: s.title || "",
        snippet: stripHtml(s.snippet || ""),
      }));
  } catch (error) {
    logProviderError("mentions.wikipedia", error, { query });
    return [];
  }
}

export interface FirehoseResult {
  available: boolean;
  mentions: SocialMention[];
  byPlatform: Record<string, number>;
  sourcesQueried: string[];
}

/** Aggregate all social/community sources for a query. */
export async function fetchMentionFirehose(query: string): Promise<FirehoseResult> {
  const results = await Promise.all([
    searchStackExchange(query),
    searchGitHub(query),
    searchProductHunt(query),
    searchMastodon(query),
    searchBluesky(query),
    searchWikipedia(query),
  ]);
  const mentions: SocialMention[] = [];
  const seen = new Set<string>();
  for (const list of results) {
    for (const m of list) {
      if (seen.has(m.url)) continue;
      seen.add(m.url);
      mentions.push(m);
    }
  }
  const byPlatform: Record<string, number> = {};
  for (const m of mentions) byPlatform[m.platform] = (byPlatform[m.platform] || 0) + 1;

  return {
    available: mentions.length > 0,
    mentions,
    byPlatform,
    sourcesQueried: ["stackexchange", "github", "producthunt", "mastodon", "bluesky", "wikipedia"],
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
}
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
