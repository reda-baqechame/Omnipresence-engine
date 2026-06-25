import type { ProviderResult } from "./types";

/**
 * Hacker News (Algolia) provider — a free, key-less, public search API over all
 * HN stories and comments. No license strings; results are real, time-stamped
 * mentions. Ideal for live community-mention monitoring alongside CSV imports.
 *
 * Docs: https://hn.algolia.com/api
 */

const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";

export interface HackerNewsMention {
  objectId: string;
  title: string;
  /** The external URL when the hit links out, else the HN discussion permalink. */
  url: string;
  permalink: string;
  author?: string;
  points?: number;
  numComments?: number;
  createdAt: string;
  matchedIn: "story" | "comment";
}

interface HnHit {
  objectID: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  _tags?: string[];
}

interface HnResponse {
  hits?: HnHit[];
}

function permalinkFor(objectId: string): string {
  return `https://news.ycombinator.com/item?id=${objectId}`;
}

/**
 * Search HN for a brand/keyword. Uses `search_by_date` ordering scoped to the
 * trailing window so monitoring surfaces fresh mentions.
 */
export async function searchHackerNews(
  query: string,
  options: { tags?: "story" | "comment" | "(story,comment)"; sinceDays?: number; limit?: number } = {}
): Promise<ProviderResult<HackerNewsMention[]>> {
  const q = query.trim();
  if (!q) return { success: false, error: "Empty query" };

  const tags = options.tags ?? "(story,comment)";
  const limit = Math.min(options.limit ?? 25, 100);

  try {
    const params = new URLSearchParams();
    params.set("query", q);
    params.set("tags", tags);
    params.set("hitsPerPage", String(limit));

    if (options.sinceDays && options.sinceDays > 0) {
      const since = Math.floor(Date.now() / 1000) - options.sinceDays * 86400;
      params.set("numericFilters", `created_at_i>${since}`);
    }

    const response = await fetch(`${HN_SEARCH_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return { success: false, error: `Hacker News API error: ${response.status}` };
    }

    const data = (await response.json()) as HnResponse;
    const qLower = q.toLowerCase();

    const mentions: HackerNewsMention[] = (data.hits || [])
      .filter((h) => h.objectID)
      .map((h) => {
        const matchedIn: HackerNewsMention["matchedIn"] = h._tags?.includes("comment")
          ? "comment"
          : "story";
        const title = h.title || h.story_title || "(comment)";
        const outbound = h.url || h.story_url || "";
        return {
          objectId: h.objectID,
          title,
          url: outbound || permalinkFor(h.objectID),
          permalink: permalinkFor(h.objectID),
          author: h.author,
          points: h.points,
          numComments: h.num_comments,
          createdAt: h.created_at || new Date().toISOString(),
          matchedIn,
        };
      })
      // Guard against Algolia's prefix/loose matching surfacing irrelevant hits.
      .filter((m) => `${m.title}`.toLowerCase().includes(qLower) || m.url.toLowerCase().includes(qLower));

    return { success: true, data: mentions, creditsUsed: 1 };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Hacker News request failed",
    };
  }
}
