export interface ProviderResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  creditsUsed?: number;
  /** Versioned provenance envelope when the adapter emits measured data. */
  envelope?: import("./envelope").ProviderEnvelopeMeta;
}

export interface AIVisibilityResult {
  brandMentioned: boolean;
  brandCited: boolean;
  competitorMentions: Record<string, boolean>;
  competitorCitations: Record<string, boolean>;
  sourceDomains: string[];
  citedUrls: string[];
  rawResponse: string;
  /**
   * True when the answer was produced with a live web-search tool (real cited
   * URLs). False for the parametric/model-knowledge path. Lets the scanner label
   * the measurement_mode honestly (grounded vs model_knowledge).
   */
  grounded?: boolean;
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
