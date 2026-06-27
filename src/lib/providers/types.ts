export interface ProviderResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  creditsUsed?: number;
}

export interface AIVisibilityResult {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  competitorCitations: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  rawResponse: string;
}

export interface SERPResult {
  organicResults: Array<{ title: string; url: string; position: number }>;
  aiOverview?: {
    present: boolean;
    text?: string;
    citedUrls: string[];
    citedDomains: string[];
  };
  brandInResults: boolean;
  competitorInResults: Record<string, boolean>;
  /** Distinct SERP feature types present (e.g. ai_overview, featured_snippet, people_also_ask). */
  serpFeatures?: string[];
}

export interface CrawlResult {
  url: string;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  schemaTypes: string[];
  schemaJson: unknown[];
  headings: Array<{ level: number; text: string }>;
  images: Array<{ src: string; alt?: string }>;
  internalLinks: string[];
  externalLinks: string[];
  wordCount: number;
  hasNoindex: boolean;
  statusCode: number;
  /** Full visible text content (tags stripped) — for AEO passage analysis */
  textContent?: string;
  /** Text of individual <p>/<li> blocks — for liftable-passage scoring */
  paragraphs?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
}
