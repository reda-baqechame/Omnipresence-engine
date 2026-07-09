export type MembershipRole = "owner" | "admin" | "member" | "viewer";
export type ProjectStatus = "draft" | "scanning" | "active" | "paused" | "archived";
export type ScanStatus = "pending" | "running" | "completed" | "failed" | "cancelling" | "cancelled";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type PromptCategory =
  | "best_of"
  | "comparison"
  | "local"
  | "problem_aware"
  | "solution_aware"
  | "pricing"
  | "trust"
  | "alternatives"
  | "reviews"
  | "transactional";
export type VisibilityEngine =
  | "google_organic"
  | "google_ai_overview"
  | "bing_organic"
  | "bing_copilot"
  | "chatgpt"
  | "perplexity"
  | "gemini"
  | "claude"
  | "youtube"
  | "reddit"
  | "quora";
export type CoverageSurface =
  | "google_business"
  | "bing_places"
  | "apple_business"
  | "linkedin"
  | "x_twitter"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "reddit"
  | "quora"
  | "g2"
  | "capterra"
  | "trustpilot"
  | "yelp"
  | "directory"
  | "review_site"
  | "other";
export type ContentAssetType =
  | "service_page"
  | "location_page"
  | "comparison_page"
  | "best_of_page"
  | "faq_page"
  | "blog_brief"
  | "blog_post"
  | "case_study"
  | "youtube_script"
  | "shorts_script"
  | "linkedin_post"
  | "x_thread"
  | "reddit_draft"
  | "quora_draft"
  | "newsletter"
  | "podcast_script"
  | "gbp_post"
  | "directory_description";
export type ContentStatus =
  | "drafted"
  | "approved"
  | "published"
  | "indexed"
  | "getting_traffic"
  | "needs_refresh";
export type AuthorityType =
  | "backlink"
  | "listicle"
  | "podcast"
  | "journalist"
  | "directory"
  | "partner_page"
  | "affiliate_page"
  | "guest_post"
  | "reddit_mention"
  | "quora_mention";
export type OutreachStatus =
  | "identified"
  | "researched"
  | "pitched"
  | "followed_up"
  | "accepted"
  | "published"
  | "rejected";
export type SubscriptionPlan = "free" | "audit" | "tracking" | "agency" | "enterprise";

export interface AuditLead {
  id: string;
  email: string;
  domain: string;
  brand_name?: string;
  industry?: string;
  score_snapshot?: {
    omnipresence?: number;
    ai_visibility?: number;
    search_visibility?: number;
    technical_readiness?: number;
    critical_issues?: number;
  };
  source: string;
  organization_id?: string | null;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  white_label_name?: string;
  white_label_logo_url?: string;
  white_label_primary_color?: string;
  plan: SubscriptionPlan;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  api_credit_limit: number;
  api_credits_used: number;
  slack_webhook_url?: string;
  notifications_enabled?: boolean;
  audit_referral_token?: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  domain: string;
  industry?: string;
  location?: string;
  competitors: string[];
  target_buyer?: string;
  main_offer?: string;
  conversion_goal?: string;
  monthly_ad_spend?: number;
  current_monthly_traffic?: number;
  status: ProjectStatus;
  last_scan_at?: string;
  daily_rank_tracking?: boolean;
  tracking_hmac?: string;
  created_at: string;
  updated_at: string;
}

export interface BrandProfile {
  id: string;
  project_id: string;
  brand_name: string;
  brand_voice?: string;
  brand_values?: string[];
  products_services?: Array<{ name: string; description: string }>;
  target_audiences?: string[];
  proof_points?: Array<{ type: string; value: string }>;
  case_studies?: Array<{ title: string; summary: string }>;
  social_profiles?: Record<string, string>;
  faq_database?: Array<{ question: string; answer: string }>;
  author_persona?: string;
  banned_words?: string[];
  offer_capsules?: Array<{ title: string; cta: string }>;
  raw_extraction?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Prompt {
  id: string;
  project_id: string;
  text: string;
  category: PromptCategory;
  priority: number;
  is_tracked: boolean;
  created_at: string;
}

export interface VisibilityRun {
  id: string;
  project_id: string;
  status: ScanStatus;
  engines: VisibilityEngine[];
  prompt_count: number;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  /** Prominence-weighted brand share of voice (0–1), persisted at scan finalize. */
  brand_sov?: number | null;
  cancel_requested_at?: string;
  cancelled_at?: string;
  /** Real USD spend attributed to this run via job-context rollup (0078); 0 until a guarded provider call runs inside it. */
  actual_cost?: number;
  /** Combined input+output LLM tokens attributed to this run. */
  tokens_used?: number;
  /** Count of guarded provider calls (LLM + paid external APIs) attributed to this run. */
  provider_calls_count?: number;
  current_step?: string | null;
  progress_percent?: number | null;
  created_at: string;
}

export interface VisibilityResult {
  id: string;
  run_id: string;
  project_id: string;
  prompt_id?: string;
  engine: VisibilityEngine;
  prompt_text: string;
  brand_mentioned: boolean;
  brand_cited: boolean;
  competitor_mentions: Record<string, boolean>;
  competitor_citations: Record<string, boolean>;
  source_domains: string[];
  cited_urls: string[];
  raw_response?: Record<string, unknown>;
  data_source?: DataQuality;
  confidence?: number;
  last_checked_at?: string;
  evidence_url?: string;
  is_estimated?: boolean;
  /** grounded = live search UI / retrieval with citations; model_knowledge = parametric LLM answer; unavailable = engine could not be measured this run. */
  measurement_mode?: "grounded" | "model_knowledge" | "unavailable";
  sentiment?: "positive" | "neutral" | "negative" | "unknown";
  /** 0-1: how strongly the brand was recommended across samples. */
  recommendation_strength?: number;
  /** The brand's own domain was cited. */
  owned_cited?: boolean;
  /** A third-party source cited the brand. */
  third_party_cited?: boolean;
  /** Ordinal position of the brand among recommended options in the answer. */
  answer_position?: number;
  sample_count?: number;
  /** 0-1 variance of brand mention across samples (sampling stability). */
  variance?: number;
  created_at: string;
}

export type DataSource = "measured" | "simulated";

/**
 * Full provenance vocabulary for the trust spine. `DataSource` is kept narrow
 * for the legacy `citation_sources` table; `DataQuality` is the platform-wide
 * label used on every metric.
 */
export type DataQuality =
  | "measured"
  | "estimated"
  | "model_knowledge"
  | "simulated"
  | "unavailable";

export type CitationGate = "index" | "crawl" | "retrieval" | "citation";

export interface Competitor {
  id: string;
  project_id: string;
  name: string;
  domain?: string;
  /** How the domain was resolved: serp, dataforseo, manual, unresolved. */
  source?: string;
  /** 0-1 confidence the domain is correct. */
  confidence?: number;
  confirmed: boolean;
  evidence_url?: string;
  created_at: string;
  updated_at: string;
}

export interface KeywordOpportunity {
  id: string;
  project_id: string;
  keyword: string;
  volume_estimate?: number;
  volume_range?: string;
  volume_low?: number;
  volume_high?: number;
  volume_confidence?: "low" | "medium" | "high";
  trend_index?: number;
  difficulty?: number;
  difficulty_method?: "ranking_authority" | "heuristic";
  intent?: string;
  our_position?: number | null;
  opportunity_score?: number;
  source?: string;
  status?: string;
  data_source?: DataQuality;
  confidence?: number;
  last_checked_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ResultsLedgerEntry {
  id: string;
  project_id: string;
  task_id?: string;
  action_type: string;
  action_surface?: string;
  description: string;
  baseline_snapshot?: Record<string, unknown>;
  outcome_snapshot?: Record<string, unknown>;
  delta_summary?: Record<string, unknown>;
  status: "pending" | "in_progress" | "completed" | "failed" | "verified";
  executed_by?: string;
  executed_at: string;
  verified_at?: string;
  created_at: string;
}

export interface AIReferral {
  id: string;
  project_id: string;
  referrer_source: string;
  landing_path?: string;
  user_agent?: string;
  session_id?: string;
  created_at: string;
}

export interface EntityProfile {
  id: string;
  project_id: string;
  wikidata_qid?: string;
  same_as_map?: Record<string, string>;
  nap_records?: Array<{ platform: string; name: string; address?: string; phone?: string }>;
  knowledge_panel_ready: boolean;
  entity_score: number;
  reconciliation_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface SchemaDeployment {
  id: string;
  project_id: string;
  page_url: string;
  schema_types: string[];
  json_ld: Record<string, unknown>;
  validation_status: "pending" | "valid" | "invalid" | "deployed";
  deployment_method?: string;
  deployed_url?: string;
  deployed_at?: string;
  created_at: string;
}

export interface CitationSource {
  id: string;
  project_id: string;
  run_id?: string;
  prompt_text: string;
  platform: string;
  source_domain: string;
  source_url?: string;
  cites_brand: boolean;
  cites_competitor: boolean;
  competitor_name?: string;
  ai_search_volume?: number;
  data_source: DataSource;
  created_at: string;
}

export interface OpsQueueItem {
  id: string;
  project_id: string;
  organization_id: string;
  action_type: string;
  title: string;
  payload?: Record<string, unknown>;
  risk_level: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "executing" | "completed" | "failed";
  assigned_to?: string;
  sla_due_at?: string;
  executed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TechnicalFinding {
  id: string;
  project_id: string;
  category: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  impact?: string;
  fix_recommendation?: string;
  affected_url?: string;
  is_resolved: boolean;
  data_source?: DataQuality;
  provider?: string;
  error_message?: string;
  confidence?: number;
  last_checked_at?: string;
  evidence_url?: string;
  is_estimated?: boolean;
  created_at: string;
}

export interface CoverageItem {
  id: string;
  project_id: string;
  surface: CoverageSurface;
  platform_name: string;
  profile_url?: string;
  is_present: boolean;
  is_optimized: boolean;
  competitor_present: boolean;
  notes?: string;
  submission_status?: "not_started" | "in_progress" | "submitted" | "live";
  submitted_at?: string;
  measured?: boolean;
  /** "measured" = we got a definitive answer; "estimated" = heuristic; "unavailable" = could not verify. */
  data_quality?: DataQuality;
  data_source?: DataQuality;
  confidence?: number;
  last_checked_at?: string;
  evidence_url?: string;
  created_at: string;
  updated_at: string;
}

export interface ContentAsset {
  id: string;
  project_id: string;
  type: ContentAssetType;
  title: string;
  content?: string;
  metadata?: Record<string, unknown>;
  status: ContentStatus;
  published_url?: string;
  parent_asset_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthorityOpportunity {
  id: string;
  project_id: string;
  type: AuthorityType;
  target_site: string;
  target_url?: string;
  contact_email?: string;
  contact_name?: string;
  pitch_angle?: string;
  outreach_email?: string;
  follow_up_email?: string;
  status: OutreachStatus;
  domain_authority?: number;
  estimated_impact?: number;
  difficulty_score?: number;
  published_url?: string;
  competitor_present: boolean;
  measured?: boolean;
  data_source?: DataQuality;
  provider?: string;
  error_message?: string;
  confidence?: number;
  last_checked_at?: string;
  evidence_url?: string;
  is_estimated?: boolean;
  citation_source_id?: string;
  created_at: string;
  updated_at: string;
}

export interface OmniPresenceScore {
  id: string;
  project_id: string;
  omnipresence_score: number;
  ai_visibility: number;
  search_visibility: number;
  local_visibility: number;
  social_presence: number;
  directory_coverage: number;
  authority_mentions: number;
  technical_readiness: number;
  conversion_readiness: number;
  breakdown?: Record<string, unknown>;
  data_source?: DataQuality;
  confidence?: number;
  /** How many of the scored inputs were genuinely measured vs total. */
  measured_inputs?: number;
  total_inputs?: number;
  created_at: string;
}

export interface RoadmapItem {
  week: number;
  title: string;
  description: string;
  impact: "critical" | "high" | "medium" | "low";
  category: string;
  estimated_hours?: number;
  evidence_label?: string;
  evidence_url?: string;
  source_type?: "technical_finding" | "coverage_gap" | "authority_opportunity" | "aeo_readiness";
}

export type ExecutionTaskSource =
  | "technical_finding"
  | "content_gap"
  | "keyword_opportunity"
  | "coverage_gap"
  | "authority"
  | "roadmap"
  | "behavior"
  | "deep_crawl"
  | "video"
  | "reputation"
  | "merchant"
  | "source_opportunity"
  | "fastest_path"
  | "manual";

export type ExecutionTaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "verified"
  | "dismissed";

export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface ExecutionTask {
  id: string;
  project_id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  source_module: ExecutionTaskSource;
  source_id?: string | null;
  category?: string | null;
  priority: TaskPriority;
  impact: number;
  effort: number;
  status: ExecutionTaskStatus;
  owner?: string | null;
  due_date?: string | null;
  evidence?: Record<string, unknown> | null;
  generated_asset_id?: string | null;
  result_metric?: Record<string, unknown> | null;
  finding_resolved?: boolean | null;
  before_metric?: Record<string, unknown> | null;
  after_metric?: Record<string, unknown> | null;
  completed_at?: string | null;
  verified_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Roadmap {
  id: string;
  project_id: string;
  duration_days: number;
  items: RoadmapItem[];
  created_at: string;
}

export interface AttributionMetric {
  id: string;
  project_id: string;
  period_start: string;
  period_end: string;
  organic_traffic: number;
  ai_referral_traffic: number;
  social_clicks: number;
  directory_referrals: number;
  search_clicks: number;
  leads: number;
  calls: number;
  bookings: number;
  purchases: number;
  revenue: number;
  paid_ads_equivalent: number;
  source_breakdown?: Record<string, number>;
  data_source?: DataQuality;
  confidence?: number;
  last_checked_at?: string;
  is_estimated?: boolean;
  /** Per-source availability so a failed GSC/Bing sync is shown as Unavailable, not 0. */
  source_availability?: Record<string, boolean>;
  created_at: string;
}

export type ReportStatus =
  | "pending"
  | "generating"
  | "ready"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface Report {
  id: string;
  project_id: string;
  share_token: string;
  title: string;
  /** @deprecated dead link since the reports bucket went private (0073) — use pdf_storage_path. */
  pdf_url?: string;
  /** @deprecated see pdf_url — use html_storage_path. */
  html_url?: string;
  pdf_storage_path?: string;
  html_storage_path?: string;
  pdf_degraded?: boolean;
  is_public: boolean;
  white_label: boolean;
  report_type?: "standard" | "deep";
  sections?: string[];
  status?: ReportStatus;
  error_message?: string;
  cancel_requested_at?: string;
  cancelled_at?: string;
  /** Pre-generation cost projection; not yet populated by any code path (0078) — always null today. */
  estimated_cost?: number | null;
  /** Real USD spend attributed to this report via job-context rollup (0078); 0 until a guarded provider call runs inside it. */
  actual_cost?: number;
  /** Combined input+output LLM tokens attributed to this report. */
  tokens_used?: number;
  /** Count of guarded provider calls (LLM + paid external APIs) attributed to this report. */
  provider_calls_count?: number;
  current_step?: string | null;
  progress_percent?: number | null;
  /** The report this one supersedes, scoped per (project_id, report_type) lineage (0081). Null for the first report in a lineage. */
  previous_report_id?: string | null;
  /** 1-based position in its (project_id, report_type) lineage. */
  version?: number;
  created_at: string;
}

/** Patch F.1b — structured report quality gate violation telemetry (internal only). */
export interface ReportQualityViolation {
  id: string;
  report_id: string | null;
  project_id: string | null;
  org_id: string | null;
  report_type: string;
  claim_id: string;
  section: string;
  claim_type: string;
  field: string;
  reason: string;
  severity: "info" | "warning" | "error";
  source_label: string | null;
  classification: string | null;
  render_path: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ProjectIntake {
  name: string;
  domain: string;
  industry: string;
  location: string;
  competitors: string[];
  target_buyer: string;
  main_offer: string;
  conversion_goal: string;
  monthly_ad_spend?: number;
  current_monthly_traffic?: number;
}
