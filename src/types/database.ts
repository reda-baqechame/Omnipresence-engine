export type MembershipRole = "owner" | "admin" | "member" | "viewer";
export type ProjectStatus = "draft" | "scanning" | "active" | "paused" | "archived";
export type ScanStatus = "pending" | "running" | "completed" | "failed";
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
  created_at: string;
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
  created_at: string;
}

export interface RoadmapItem {
  week: number;
  title: string;
  description: string;
  impact: "critical" | "high" | "medium" | "low";
  category: string;
  estimated_hours?: number;
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
  created_at: string;
}

export interface Report {
  id: string;
  project_id: string;
  share_token: string;
  title: string;
  pdf_url?: string;
  is_public: boolean;
  white_label: boolean;
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
