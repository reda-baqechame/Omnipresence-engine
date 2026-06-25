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
  source: "bing_api" | "serper" | "brave" | "playwright" | "simulated";
}

export interface BacklinkRow {
  source_url: string;
  source_domain: string;
  target_url: string;
  anchor: string;
  first_seen?: string;
  last_seen?: string;
  domain_rank?: number;
}

export interface KeywordSuggestion {
  keyword: string;
  source: "autocomplete" | "related" | "cluster";
  volume_estimate?: number;
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
