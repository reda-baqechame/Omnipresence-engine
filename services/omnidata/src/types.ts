export interface SerpItem {
  type: string;
  rank_absolute?: number;
  rank_group?: number;
  title?: string;
  url?: string;
  description?: string;
  domain?: string;
  items?: SerpItem[];
  pixel_rank?: number;
}

export interface SerpResult {
  keyword: string;
  location: string;
  items: SerpItem[];
  ai_overview?: { text: string; sources: Array<{ title: string; url: string }> };
  featured_snippet?: SerpItem;
  people_also_ask?: Array<{ question: string; answer?: string }>;
  local_pack?: SerpItem[];
  source: "bing_api" | "serper" | "brave" | "playwright";
}

export interface BacklinkRow {
  source_url: string;
  source_domain: string;
  target_url: string;
  anchor: string;
  first_seen?: string;
  last_seen?: string;
  domain_rank?: number;
  /** Provenance of this row so callers can label real vs. estimated data. */
  source?: "webgraph" | "link_operator";
  /** Number of links from this referring domain (webgraph only). */
  link_count?: number;
}

/**
 * URL-level backlink edge (the Presence Backlink Graph row). Unlike BacklinkRow
 * (domain-level, webgraph-derived), this is crawl-verified: the link was found
 * live in the source page's HTML with its real anchor text and rel attributes.
 */
export interface BacklinkLinkRow {
  source_url: string;
  source_domain: string;
  target_url: string;
  target_domain: string;
  anchor: string;
  /** rel tokens present on the <a>, e.g. ["nofollow","sponsored"]. */
  rel: string[];
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
  http_status: number;
  /** First time this exact (source_url -> target_url) edge was crawl-verified. */
  first_seen: string;
  /** Most recent time the edge was crawl-verified live. */
  last_seen: string;
  domain_rank?: number;
  /**
   * "crawl_verified" = link confirmed live in the source HTML this run;
   * "lost" = previously seen but absent on this re-crawl;
   * "candidate" = webgraph seed not yet (or not) crawl-confirmed.
   */
  verification: "crawl_verified" | "lost" | "candidate";
}

export interface KeywordSuggestion {
  keyword: string;
  source: "autocomplete" | "related" | "cluster";
  volume_estimate?: number;
  /** Real CPC (USD) from Google Ads Keyword Planner when available. */
  cpc?: number;
  competition?: "LOW" | "MEDIUM" | "HIGH" | "UNSPECIFIED";
  /** Relative Google Trends demand index (0-100), not an absolute volume. */
  trend_index?: number;
  /** Recent-vs-earlier momentum from Google Trends, -100..100. */
  trend_momentum?: number;
  /**
   * Provenance of the demand figure:
   * - "keyword_planner": real Google Ads data (bucketed)
   * - "trends_estimated": heuristic volume + real Google Trends demand index
   * - "estimated": autocomplete/SERP heuristic only
   */
  data_source?: "keyword_planner" | "trends_estimated" | "estimated";
}

export interface RankSnapshot {
  keyword: string;
  domain: string;
  position: number | null;
  url?: string;
  serp_features: string[];
  checked_at: string;
}

export interface CrawlPage {
  url: string;
  status: number;
  title?: string;
  links: string[];
  simhash: string;
  pagerank: number;
}

export interface TaskRecord {
  id: string;
  tag: string;
  status: "pending" | "processing" | "completed" | "failed";
  endpoint: string;
  payload: unknown;
  result?: unknown;
  error?: string;
  created_at: string;
  completed_at?: string;
}
