/**
 * Wikimedia / Wikipedia signals (free, keyless).
 *
 * - Article presence: does an entity have a Wikipedia page? (entity authority)
 * - Pageviews: Wikimedia REST Pageviews API for brand/entity interest over time.
 *
 * Wikipedia presence is a strong AEO signal: entities with Wikipedia/Wikidata
 * records are disproportionately cited by LLMs and AI search engines.
 */

export interface WikipediaArticle {
  title: string;
  url: string;
  description?: string;
  exists: boolean;
}

export interface WikiInterest {
  article?: string;
  exists: boolean;
  /**
   * Whether the pageviews measurement actually succeeded. false means the
   * pageviews API failed/was unreachable — `totalViews:0` is then "unknown",
   * NOT a measured zero. Lets callers avoid showing a false "0 interest".
   */
  available: boolean;
  /** Total pageviews across the lookback window. */
  totalViews: number;
  /** Daily timeline (date -> views). */
  timeline: Array<{ date: string; views: number }>;
}

const WM = "https://wikimedia.org/api/rest_v1";
const UA = "OmniPresenceEngine/1.0 (AEO research; contact: support@omnipresence)";

function fetchJson<T>(url: string): Promise<T | null> {
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", connection: "close" },
    signal: AbortSignal.timeout(12_000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
}

/** Resolve the best-matching Wikipedia article for a brand/entity name. */
export async function findWikipediaArticle(name: string): Promise<WikipediaArticle> {
  const notFound: WikipediaArticle = { title: name, url: "", exists: false };
  const data = await fetchJson<[string, string[], string[], string[]]>(
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
      name
    )}&limit=1&namespace=0&format=json`
  );
  if (!data || !Array.isArray(data) || !data[1]?.length) return notFound;
  const title = data[1][0];
  const description = data[2]?.[0];
  const url = data[3]?.[0] || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
  return { title, url, description, exists: true };
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Brand/entity interest from Wikipedia pageviews over the last `days` days.
 * Returns totals + daily timeline; exists=false when there is no article.
 */
export async function getWikiInterest(name: string, days = 90): Promise<WikiInterest> {
  const article = await findWikipediaArticle(name);
  if (!article.exists) {
    return { exists: false, available: true, totalViews: 0, timeline: [] };
  }

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const encoded = encodeURIComponent(article.title.replace(/\s+/g, "_"));
  const url = `${WM}/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encoded}/daily/${yyyymmdd(
    start
  )}/${yyyymmdd(end)}`;

  const data = await fetchJson<{ items?: Array<{ timestamp: string; views: number }> }>(url);
  if (data === null) {
    // Article exists, but the pageviews API failed — don't report a false 0.
    return { article: article.title, exists: true, available: false, totalViews: 0, timeline: [] };
  }
  const items = data.items || [];
  const timeline = items.map((i) => ({
    date: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}-${i.timestamp.slice(6, 8)}`,
    views: i.views,
  }));
  const totalViews = timeline.reduce((sum, p) => sum + p.views, 0);

  return { article: article.title, exists: true, available: true, totalViews, timeline };
}

/** Lightweight existence check used by entity/AEO authority signals. */
export async function hasWikipediaPresence(name: string): Promise<boolean> {
  const article = await findWikipediaArticle(name);
  return article.exists;
}

/** Check Wikidata entity presence (structured knowledge graph). */
export async function hasWikidataEntity(name: string): Promise<boolean> {
  const data = await fetchJson<{ search?: Array<{ id: string }> }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      name
    )}&language=en&limit=1&format=json&origin=*`
  );
  return Boolean(data?.search?.length);
}
