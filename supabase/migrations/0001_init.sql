-- PresenceOS / OmniPresence Engine — Initial Schema
-- Multi-tenant with RLS

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'member', 'viewer');
CREATE TYPE project_status AS ENUM ('draft', 'scanning', 'active', 'paused', 'archived');
CREATE TYPE scan_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE finding_severity AS ENUM ('critical', 'high', 'medium', 'low', 'info');
CREATE TYPE prompt_category AS ENUM (
  'best_of', 'comparison', 'local', 'problem_aware', 'solution_aware',
  'pricing', 'trust', 'alternatives', 'reviews', 'transactional'
);
CREATE TYPE visibility_engine AS ENUM (
  'google_organic', 'google_ai_overview', 'bing_organic', 'bing_copilot',
  'chatgpt', 'perplexity', 'gemini', 'claude', 'youtube', 'reddit', 'quora'
);
CREATE TYPE coverage_surface AS ENUM (
  'google_business', 'bing_places', 'apple_business', 'linkedin', 'x_twitter',
  'facebook', 'instagram', 'tiktok', 'youtube', 'reddit', 'quora', 'g2',
  'capterra', 'trustpilot', 'yelp', 'directory', 'review_site', 'other'
);
CREATE TYPE content_asset_type AS ENUM (
  'service_page', 'location_page', 'comparison_page', 'best_of_page', 'faq_page',
  'blog_brief', 'blog_post', 'case_study', 'youtube_script', 'shorts_script',
  'linkedin_post', 'x_thread', 'reddit_draft', 'quora_draft', 'newsletter',
  'podcast_script', 'gbp_post', 'directory_description'
);
CREATE TYPE content_status AS ENUM (
  'drafted', 'approved', 'published', 'indexed', 'getting_traffic', 'needs_refresh'
);
CREATE TYPE authority_type AS ENUM (
  'backlink', 'listicle', 'podcast', 'journalist', 'directory', 'partner_page',
  'affiliate_page', 'guest_post', 'reddit_mention', 'quora_mention'
);
CREATE TYPE outreach_status AS ENUM (
  'identified', 'researched', 'pitched', 'followed_up', 'accepted', 'published', 'rejected'
);
CREATE TYPE subscription_plan AS ENUM ('free', 'audit', 'tracking', 'agency', 'enterprise');

-- Organizations (agencies / brands)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  white_label_name TEXT,
  white_label_logo_url TEXT,
  white_label_primary_color TEXT DEFAULT '#6366f1',
  plan subscription_plan NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  api_credit_limit INTEGER DEFAULT 1000,
  api_credits_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memberships
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role membership_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- Projects (one per audited brand)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  industry TEXT,
  location TEXT,
  competitors TEXT[] DEFAULT '{}',
  target_buyer TEXT,
  main_offer TEXT,
  conversion_goal TEXT,
  monthly_ad_spend NUMERIC(12,2),
  current_monthly_traffic INTEGER,
  status project_status NOT NULL DEFAULT 'draft',
  last_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brand Knowledge Graph profiles
CREATE TABLE brand_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  brand_voice TEXT,
  brand_values TEXT[],
  products_services JSONB DEFAULT '[]',
  target_audiences TEXT[],
  proof_points JSONB DEFAULT '[]',
  case_studies JSONB DEFAULT '[]',
  social_profiles JSONB DEFAULT '{}',
  faq_database JSONB DEFAULT '[]',
  author_persona TEXT,
  banned_words TEXT[],
  offer_capsules JSONB DEFAULT '[]',
  raw_extraction JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Buyer-intent prompts
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category prompt_category NOT NULL,
  priority INTEGER DEFAULT 50,
  is_tracked BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Visibility scan runs
CREATE TABLE visibility_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status scan_status NOT NULL DEFAULT 'pending',
  engines visibility_engine[] DEFAULT '{}',
  prompt_count INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-prompt visibility results
CREATE TABLE visibility_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES visibility_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
  engine visibility_engine NOT NULL,
  prompt_text TEXT NOT NULL,
  brand_mentioned BOOLEAN DEFAULT false,
  brand_cited BOOLEAN DEFAULT false,
  competitor_mentions JSONB DEFAULT '{}',
  competitor_citations JSONB DEFAULT '{}',
  source_domains TEXT[] DEFAULT '{}',
  cited_urls TEXT[] DEFAULT '{}',
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Technical audit findings
CREATE TABLE technical_findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity finding_severity NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  impact TEXT,
  fix_recommendation TEXT,
  affected_url TEXT,
  is_resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform coverage items
CREATE TABLE coverage_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  surface coverage_surface NOT NULL,
  platform_name TEXT NOT NULL,
  profile_url TEXT,
  is_present BOOLEAN DEFAULT false,
  is_optimized BOOLEAN DEFAULT false,
  competitor_present BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content assets
CREATE TABLE content_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type content_asset_type NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  status content_status NOT NULL DEFAULT 'drafted',
  published_url TEXT,
  parent_asset_id UUID REFERENCES content_assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Authority opportunities
CREATE TABLE authority_opportunities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type authority_type NOT NULL,
  target_site TEXT NOT NULL,
  target_url TEXT,
  contact_email TEXT,
  contact_name TEXT,
  pitch_angle TEXT,
  outreach_email TEXT,
  follow_up_email TEXT,
  status outreach_status NOT NULL DEFAULT 'identified',
  domain_authority INTEGER,
  estimated_impact INTEGER,
  difficulty_score INTEGER,
  published_url TEXT,
  competitor_present BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OmniPresence scores (time-series)
CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  omnipresence_score NUMERIC(5,2) NOT NULL,
  ai_visibility NUMERIC(5,2) NOT NULL DEFAULT 0,
  search_visibility NUMERIC(5,2) NOT NULL DEFAULT 0,
  local_visibility NUMERIC(5,2) NOT NULL DEFAULT 0,
  social_presence NUMERIC(5,2) NOT NULL DEFAULT 0,
  directory_coverage NUMERIC(5,2) NOT NULL DEFAULT 0,
  authority_mentions NUMERIC(5,2) NOT NULL DEFAULT 0,
  technical_readiness NUMERIC(5,2) NOT NULL DEFAULT 0,
  conversion_readiness NUMERIC(5,2) NOT NULL DEFAULT 0,
  breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Execution roadmaps
CREATE TABLE roadmaps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  duration_days INTEGER NOT NULL DEFAULT 90,
  items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Attribution metrics (Phase 6)
CREATE TABLE attribution_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  organic_traffic INTEGER DEFAULT 0,
  ai_referral_traffic INTEGER DEFAULT 0,
  social_clicks INTEGER DEFAULT 0,
  directory_referrals INTEGER DEFAULT 0,
  search_clicks INTEGER DEFAULT 0,
  leads INTEGER DEFAULT 0,
  calls INTEGER DEFAULT 0,
  bookings INTEGER DEFAULT 0,
  purchases INTEGER DEFAULT 0,
  revenue NUMERIC(12,2) DEFAULT 0,
  paid_ads_equivalent NUMERIC(12,2) DEFAULT 0,
  source_breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth connections (GSC, Bing, GA4)
CREATE TABLE oauth_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, provider)
);

-- Shareable reports
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  title TEXT NOT NULL,
  pdf_url TEXT,
  is_public BOOLEAN DEFAULT false,
  white_label BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API usage metering
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  credits_used INTEGER DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_memberships_org ON memberships(organization_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_projects_org ON projects(organization_id);
CREATE INDEX idx_prompts_project ON prompts(project_id);
CREATE INDEX idx_visibility_runs_project ON visibility_runs(project_id);
CREATE INDEX idx_visibility_results_run ON visibility_results(run_id);
CREATE INDEX idx_visibility_results_project ON visibility_results(project_id);
CREATE INDEX idx_technical_findings_project ON technical_findings(project_id);
CREATE INDEX idx_coverage_items_project ON coverage_items(project_id);
CREATE INDEX idx_content_assets_project ON content_assets(project_id);
CREATE INDEX idx_authority_opportunities_project ON authority_opportunities(project_id);
CREATE INDEX idx_scores_project ON scores(project_id);
CREATE INDEX idx_attribution_metrics_project ON attribution_metrics(project_id);
CREATE INDEX idx_api_usage_org ON api_usage(organization_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER brand_profiles_updated_at BEFORE UPDATE ON brand_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER coverage_items_updated_at BEFORE UPDATE ON coverage_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER content_assets_updated_at BEFORE UPDATE ON content_assets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER authority_opportunities_updated_at BEFORE UPDATE ON authority_opportunities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER oauth_connections_updated_at BEFORE UPDATE ON oauth_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- RLS Policies
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE attribution_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

-- Helper: get user's org IDs
CREATE OR REPLACE FUNCTION get_user_org_ids()
RETURNS SETOF UUID AS $$
  SELECT organization_id FROM memberships WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Profiles: users see own profile
CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid());

-- Organizations: members can read their orgs
CREATE POLICY orgs_select ON organizations FOR SELECT
  USING (id IN (SELECT get_user_org_ids()));
CREATE POLICY orgs_update ON organizations FOR UPDATE
  USING (id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner', 'admin')));

-- Memberships: members see org memberships
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Projects: org members access
CREATE POLICY projects_all ON projects FOR ALL
  USING (organization_id IN (SELECT get_user_org_ids()));

-- Brand profiles
CREATE POLICY brand_profiles_all ON brand_profiles FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Prompts
CREATE POLICY prompts_all ON prompts FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Visibility runs & results
CREATE POLICY visibility_runs_all ON visibility_runs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
CREATE POLICY visibility_results_all ON visibility_results FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Technical findings
CREATE POLICY technical_findings_all ON technical_findings FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Coverage items
CREATE POLICY coverage_items_all ON coverage_items FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Content assets
CREATE POLICY content_assets_all ON content_assets FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Authority opportunities
CREATE POLICY authority_opportunities_all ON authority_opportunities FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Scores
CREATE POLICY scores_all ON scores FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Roadmaps
CREATE POLICY roadmaps_all ON roadmaps FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Attribution metrics
CREATE POLICY attribution_metrics_all ON attribution_metrics FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- OAuth connections
CREATE POLICY oauth_connections_all ON oauth_connections FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Reports (public share via token handled in API)
CREATE POLICY reports_all ON reports FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- API usage
CREATE POLICY api_usage_select ON api_usage FOR SELECT
  USING (organization_id IN (SELECT get_user_org_ids()));
