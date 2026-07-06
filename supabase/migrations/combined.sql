-- PresenceOS combined migration (67 files)
-- Generated 2026-07-06T23:22:11.635Z

-- ========== 0001_init.sql ==========

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


-- ========== 0002_audit_leads.sql ==========

-- Public audit lead capture (marketing funnel)
CREATE TABLE audit_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  brand_name TEXT,
  industry TEXT,
  score_snapshot JSONB,
  source TEXT NOT NULL DEFAULT 'public_audit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_leads_email ON audit_leads(email);
CREATE INDEX idx_audit_leads_created_at ON audit_leads(created_at DESC);

ALTER TABLE audit_leads ENABLE ROW LEVEL SECURITY;


-- ========== 0003_org_notifications.sql ==========

-- Organization notification settings + audit leads read access
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;

CREATE POLICY audit_leads_select_authenticated ON audit_leads
  FOR SELECT TO authenticated
  USING (true);


-- ========== 0004_rls_hardening.sql ==========

-- Harden RLS: restrict audit leads to org admins/owners

DROP POLICY IF EXISTS audit_leads_select_authenticated ON audit_leads;

CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY audit_leads_select_admin ON audit_leads
  FOR SELECT TO authenticated
  USING (is_org_admin());

-- OAuth connections: restrict writes to admin/owner
DROP POLICY IF EXISTS oauth_connections_all ON oauth_connections;

CREATE POLICY oauth_connections_select ON oauth_connections FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY oauth_connections_insert ON oauth_connections FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY oauth_connections_update ON oauth_connections FOR UPDATE
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );

CREATE POLICY oauth_connections_delete ON oauth_connections FOR DELETE
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );


-- ========== 0005_webhook_events.sql ==========

-- Stripe webhook idempotency (service-role only; no user policies)

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- No policies: only service role can read/write


-- ========== 0006_storage_reports.sql ==========

-- Public reports storage bucket for PDF + HTML artifacts

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reports',
  'reports',
  true,
  52428800,
  ARRAY['application/pdf', 'text/html', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- Public read; uploads use service role (bypasses RLS)
DROP POLICY IF EXISTS reports_public_read ON storage.objects;
CREATE POLICY reports_public_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'reports');


-- ========== 0007_directory_submissions.sql ==========

-- Directory submission tracking on coverage items

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS submission_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE coverage_items DROP CONSTRAINT IF EXISTS coverage_items_submission_status_check;
ALTER TABLE coverage_items
  ADD CONSTRAINT coverage_items_submission_status_check
  CHECK (submission_status IN ('not_started', 'in_progress', 'submitted', 'live'));


-- ========== 0008_free_access.sql ==========

-- Free access: remove API credit caps on existing organizations

UPDATE organizations
SET api_credit_limit = 9999999
WHERE api_credit_limit IS NULL OR api_credit_limit < 9999999;


-- ========== 0009_v2_real_results.sql ==========

-- OmniPresence Engine v2: real-results tables

-- Results ledger: proof of executed actions for guarantee tracking
CREATE TABLE IF NOT EXISTS results_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  action_surface TEXT,
  description TEXT NOT NULL,
  baseline_snapshot JSONB DEFAULT '{}',
  outcome_snapshot JSONB DEFAULT '{}',
  delta_summary JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'verified')),
  executed_by TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_results_ledger_project ON results_ledger(project_id);
CREATE INDEX IF NOT EXISTS idx_results_ledger_action ON results_ledger(action_type);

-- AI referral hits (edge-detected)
CREATE TABLE IF NOT EXISTS ai_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  referrer_source TEXT NOT NULL,
  landing_path TEXT,
  user_agent TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_referrals_project ON ai_referrals(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_referrals_source ON ai_referrals(referrer_source);

-- Entity profiles (Wikidata-first knowledge graph)
CREATE TABLE IF NOT EXISTS entity_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  wikidata_qid TEXT,
  same_as_map JSONB DEFAULT '{}',
  nap_records JSONB DEFAULT '[]',
  knowledge_panel_ready BOOLEAN DEFAULT false,
  entity_score INTEGER DEFAULT 0,
  reconciliation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schema deployments
CREATE TABLE IF NOT EXISTS schema_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_url TEXT NOT NULL,
  schema_types TEXT[] DEFAULT '{}',
  json_ld JSONB NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending', 'valid', 'invalid', 'deployed')),
  deployment_method TEXT,
  deployed_url TEXT,
  deployed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schema_deployments_project ON schema_deployments(project_id);

-- Real citation sources from LLM Mentions / AI Overview
CREATE TABLE IF NOT EXISTS citation_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID REFERENCES visibility_runs(id) ON DELETE SET NULL,
  prompt_text TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  source_url TEXT,
  cites_brand BOOLEAN DEFAULT false,
  cites_competitor BOOLEAN DEFAULT false,
  competitor_name TEXT,
  ai_search_volume INTEGER,
  data_source TEXT NOT NULL DEFAULT 'measured' CHECK (data_source IN ('measured', 'simulated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citation_sources_project ON citation_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_citation_sources_domain ON citation_sources(source_domain);

-- Ops queue for DFY console
CREATE TABLE IF NOT EXISTS ops_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executing', 'completed', 'failed')),
  assigned_to UUID REFERENCES profiles(id),
  sla_due_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_queue_status ON ops_queue(status);
CREATE INDEX IF NOT EXISTS idx_ops_queue_org ON ops_queue(organization_id);

-- Extend existing tables
ALTER TABLE authority_opportunities
  ADD COLUMN IF NOT EXISTS measured BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS citation_source_id UUID REFERENCES citation_sources(id);

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS measured BOOLEAN DEFAULT false;

-- RLS
ALTER TABLE results_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE citation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY results_ledger_access ON results_ledger FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY ai_referrals_access ON ai_referrals FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY entity_profiles_access ON entity_profiles FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY schema_deployments_access ON schema_deployments FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY citation_sources_access ON citation_sources FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY ops_queue_access ON ops_queue FOR ALL
  USING (organization_id IN (SELECT get_user_org_ids()));


-- ========== 0010_auth_signup_fix.sql ==========

-- Fix signup when profiles RLS blocks handle_new_user trigger inserts

DO $$ BEGIN
  CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);
  RETURN NEW;
END;
$function$;


-- ========== 0011_guarantee.sql ==========

-- Guarantee spine: contracts, baseline lock, claims workflow

CREATE TABLE IF NOT EXISTS guarantee_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  kpi_metric TEXT NOT NULL CHECK (kpi_metric IN ('omnipresence_score', 'citation_rate', 'ai_referral_traffic', 'visibility_mention_rate')),
  threshold_value NUMERIC NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 90,
  plan_tier TEXT NOT NULL DEFAULT 'tracking',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'verified', 'failed', 'claimed', 'closed')),
  baseline_locked_at TIMESTAMPTZ,
  baseline_snapshot JSONB DEFAULT '{}',
  verified_at TIMESTAMPTZ,
  delta_summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guarantee_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES guarantee_contracts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'under_review', 'approved', 'denied', 'credited')),
  evidence JSONB DEFAULT '[]',
  remedy_type TEXT NOT NULL DEFAULT 'service_credit' CHECK (remedy_type IN ('service_credit', 'work_free')),
  stripe_credit_id TEXT,
  credit_amount_cents INTEGER,
  reviewer_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guarantee_contracts_project ON guarantee_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_claims_contract ON guarantee_claims(contract_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_claims_project ON guarantee_claims(project_id);

ALTER TABLE guarantee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE guarantee_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guarantee_contracts_org_access ON guarantee_contracts;
CREATE POLICY guarantee_contracts_org_access ON guarantee_contracts
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS guarantee_claims_org_access ON guarantee_claims;
CREATE POLICY guarantee_claims_org_access ON guarantee_claims
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid()
    )
  );


-- ========== 0012_phase2.sql ==========

-- Phase 2: Programmatic SEO, rank tracking, internal linking

CREATE TABLE IF NOT EXISTS pseo_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('location_page', 'service_page', 'best_of_page', 'comparison_page')),
  url_pattern TEXT NOT NULL DEFAULT '/{slug}',
  services TEXT[] DEFAULT '{}',
  locations TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'completed', 'paused')),
  generated_count INT NOT NULL DEFAULT 0,
  max_pages INT NOT NULL DEFAULT 50,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rank_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'United States',
  target_url TEXT,
  is_striking_distance BOOLEAN DEFAULT false,
  last_position INT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword, location)
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id UUID NOT NULL REFERENCES rank_keywords(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position INT,
  ranking_url TEXT,
  serp_features TEXT[] DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_keyword ON rank_snapshots(keyword_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS internal_link_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_suggestion TEXT NOT NULL,
  relevance_score INT NOT NULL DEFAULT 0 CHECK (relevance_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'approved', 'applied', 'rejected')),
  context_snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_url, target_url)
);

ALTER TABLE pseo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_link_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY pseo_campaigns_org ON pseo_campaigns FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY rank_keywords_org ON rank_keywords FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY rank_snapshots_org ON rank_snapshots FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY internal_links_org ON internal_link_opportunities FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0013_backlink_snapshots.sql ==========

-- Backlink monitoring snapshots

CREATE TABLE IF NOT EXISTS backlink_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  backlinks JSONB NOT NULL DEFAULT '[]',
  total_count INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  lost_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backlink_snapshots_project ON backlink_snapshots(project_id, created_at DESC);

ALTER TABLE backlink_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY backlink_snapshots_org ON backlink_snapshots FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0014_project_integrations.sql ==========

-- Project integrations (CMS, social, GBP credentials — encrypted at app layer)

CREATE TABLE IF NOT EXISTS project_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('wordpress', 'webflow', 'shopify', 'buffer', 'ayrshare', 'gbp')),
  credentials_encrypted TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_project_integrations_project ON project_integrations(project_id);

ALTER TABLE project_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_integrations_org ON project_integrations FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0015_intelligence.sql ==========

-- Phase 6: Keyword intelligence + content gap storage

CREATE TABLE IF NOT EXISTS keyword_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  volume_estimate INT,
  difficulty INT CHECK (difficulty IS NULL OR difficulty BETWEEN 0 AND 100),
  intent TEXT,
  our_position INT,
  opportunity_score INT NOT NULL DEFAULT 0 CHECK (opportunity_score BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'omnidata_serp',
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'tracking', 'targeted', 'ranking', 'dismissed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword)
);

CREATE TABLE IF NOT EXISTS content_gap_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  competitor_domain TEXT NOT NULL,
  competitor_position INT,
  our_position INT,
  opportunity_score INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'brief_queued', 'published', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword, competitor_domain)
);

CREATE INDEX IF NOT EXISTS idx_keyword_opportunities_project ON keyword_opportunities(project_id, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_content_gap_project ON content_gap_findings(project_id, opportunity_score DESC);

ALTER TABLE keyword_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_gap_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY keyword_opportunities_org ON keyword_opportunities FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY content_gap_org ON content_gap_findings FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0016_phase8.sql ==========

-- Phase 8: indexing log, link building orders, community mentions

CREATE TABLE IF NOT EXISTS url_indexing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('indexnow', 'bing', 'google')),
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS link_building_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  anchor_text TEXT NOT NULL,
  anchor_type TEXT NOT NULL CHECK (anchor_type IN ('branded', 'partial', 'exact')),
  vendor_tier TEXT NOT NULL DEFAULT 'growth',
  estimated_dr INT DEFAULT 35,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'live', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('reddit', 'quora', 'other')),
  url TEXT NOT NULL,
  keyword TEXT,
  mention_type TEXT DEFAULT 'brand',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE url_indexing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_building_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY url_indexing_log_access ON url_indexing_log FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY link_building_orders_access ON link_building_orders FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY community_mentions_access ON community_mentions FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0017_phase9.sql ==========

-- Phase 9: visitor identity sessions

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  landing_path TEXT,
  referrer_source TEXT,
  company_name TEXT,
  company_domain TEXT,
  industry TEXT,
  enriched BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_project ON visitor_sessions(project_id, created_at DESC);

ALTER TABLE visitor_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY visitor_sessions_access ON visitor_sessions FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0018_aeo_readiness.sql ==========

-- Phase 10: 7-lever AEO Readiness snapshot per project

CREATE TABLE IF NOT EXISTS aeo_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  readiness_score NUMERIC NOT NULL DEFAULT 0,
  deterministic_score NUMERIC NOT NULL DEFAULT 0,
  probabilistic_score NUMERIC NOT NULL DEFAULT 0,
  levers JSONB NOT NULL DEFAULT '[]'::jsonb,
  deterministic_deliverables_met BOOLEAN NOT NULL DEFAULT false,
  next_best_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  domain_authority NUMERIC,
  page_speed_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_aeo_readiness_project ON aeo_readiness(project_id);

ALTER TABLE aeo_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY aeo_readiness_access ON aeo_readiness FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0019_phase11.sql ==========

-- Phase 11: Free Data Moat
-- Extend community mention platforms to include Hacker News and GitHub so the
-- keyless community engine can persist those real mentions.

ALTER TABLE community_mentions DROP CONSTRAINT IF EXISTS community_mentions_platform_check;
ALTER TABLE community_mentions
  ADD CONSTRAINT community_mentions_platform_check
  CHECK (platform IN ('reddit', 'quora', 'hacker_news', 'github', 'other'));


-- ========== 0020_provenance.sql ==========

-- Phase 1: Trust Spine — data provenance + confirmed competitor domains.
-- Every user-facing metric gets first-class provenance so the UI can label each
-- number Live / Estimated / Model-knowledge / Demo / Unavailable, and a failed
-- provider is never persisted as a confident zero.

-- Provenance columns (all idempotent) --------------------------------------
ALTER TABLE visibility_results
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE technical_findings
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS data_quality TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT;

ALTER TABLE authority_opportunities
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS measured_inputs INT,
  ADD COLUMN IF NOT EXISTS total_inputs INT;

ALTER TABLE keyword_opportunities
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS volume_range TEXT,
  ADD COLUMN IF NOT EXISTS volume_low INT,
  ADD COLUMN IF NOT EXISTS volume_high INT,
  ADD COLUMN IF NOT EXISTS volume_confidence TEXT,
  ADD COLUMN IF NOT EXISTS difficulty_method TEXT,
  ADD COLUMN IF NOT EXISTS trend_index INT;

ALTER TABLE attribution_metrics
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_availability JSONB;

-- Confirmed competitor domains ---------------------------------------------
-- Replaces brand-name + ".com" guessing with SERP-resolved, confidence-scored,
-- human-confirmable competitor domains.
CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  source TEXT,
  confidence NUMERIC,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  evidence_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_competitors_project ON competitors(project_id);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY competitors_org ON competitors FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0021_ai_measurement.sql ==========

-- Phase 2: Honest AI Measurement.
-- Distinguish grounded (live search UI / retrieval with citations) from
-- model_knowledge (an LLM's parametric answer with no browsing), and capture the
-- richer signals experts need: sentiment, recommendation strength, whether the
-- brand's OWN site was cited vs third-party, answer position, and the sampling
-- stability (sample_count + variance) behind each yes/no.

ALTER TABLE visibility_results
  ADD COLUMN IF NOT EXISTS measurement_mode TEXT,          -- grounded | model_knowledge
  ADD COLUMN IF NOT EXISTS sentiment TEXT,                 -- positive | neutral | negative | unknown
  ADD COLUMN IF NOT EXISTS recommendation_strength NUMERIC, -- 0-1 (how strongly recommended)
  ADD COLUMN IF NOT EXISTS owned_cited BOOLEAN,            -- brand's own domain was cited
  ADD COLUMN IF NOT EXISTS third_party_cited BOOLEAN,      -- a third-party source cited the brand
  ADD COLUMN IF NOT EXISTS answer_position INT,            -- ordinal position of the brand in the answer
  ADD COLUMN IF NOT EXISTS sample_count INT,               -- number of samples behind this result
  ADD COLUMN IF NOT EXISTS variance NUMERIC;               -- 0-1 variance of brand mention across samples


-- ========== 0022_agency.sql ==========

-- Phase 3: Agency layer — white-label client portal + custom domain.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS white_label_domain TEXT,
  ADD COLUMN IF NOT EXISTS client_portal_enabled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_organizations_wl_domain ON organizations(white_label_domain);


-- ========== 0023_execution_tasks.sql ==========

-- Phase 4: Execution Task Engine
-- One unified, tracked action model bridging technical findings, content/keyword
-- gaps, coverage gaps, authority opportunities, and roadmap items into tasks with
-- verified outcomes on re-scan.

CREATE TABLE IF NOT EXISTS execution_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- where this task came from: technical_finding | content_gap | keyword_opportunity
  -- | coverage_gap | authority | roadmap | manual
  source_module TEXT NOT NULL DEFAULT 'manual',
  -- loose reference to the originating row (no FK: source rows can be wiped on re-scan)
  source_id TEXT,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  impact INT NOT NULL DEFAULT 0,
  effort INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'verified', 'dismissed')),
  owner UUID REFERENCES profiles(id),
  due_date DATE,
  evidence JSONB DEFAULT '{}',
  generated_asset_id UUID,
  result_metric JSONB DEFAULT '{}',
  -- rescan verification linkage
  finding_resolved BOOLEAN,
  before_metric JSONB,
  after_metric JSONB,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_module, source_id)
);

CREATE INDEX IF NOT EXISTS idx_execution_tasks_project ON execution_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_execution_tasks_priority ON execution_tasks(project_id, priority);

ALTER TABLE execution_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_tasks_all ON execution_tasks;
CREATE POLICY execution_tasks_all ON execution_tasks FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_execution_tasks_updated ON execution_tasks;
CREATE TRIGGER trg_execution_tasks_updated
  BEFORE UPDATE ON execution_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ========== 0024_rank_depth.sql ==========

-- Phase 8: Expert rank tracking depth
-- device + geo dimensions, surfaced SERP features, competitor overlay,
-- share-of-voice, cannibalization, brand-in-AI-Overview, and rank-drop alerts.

ALTER TABLE rank_keywords
  ADD COLUMN IF NOT EXISTS device TEXT NOT NULL DEFAULT 'desktop',
  ADD COLUMN IF NOT EXISTS last_serp_features JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cannibalization_urls JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS competitor_overlay JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS share_of_voice NUMERIC,
  ADD COLUMN IF NOT EXISTS brand_in_ai_overview BOOLEAN;

-- Allow the same keyword to be tracked per-device.
ALTER TABLE rank_keywords DROP CONSTRAINT IF EXISTS rank_keywords_project_id_keyword_location_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_keywords_unique
  ON rank_keywords(project_id, keyword, location, device);

ALTER TABLE rank_snapshots
  ADD COLUMN IF NOT EXISTS device TEXT,
  ADD COLUMN IF NOT EXISTS cannibalization_urls JSONB,
  ADD COLUMN IF NOT EXISTS competitor_overlay JSONB,
  ADD COLUMN IF NOT EXISTS share_of_voice NUMERIC,
  ADD COLUMN IF NOT EXISTS brand_in_ai_overview BOOLEAN;

CREATE TABLE IF NOT EXISTS rank_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES rank_keywords(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'rank_drop',
  previous_position INT,
  current_position INT,
  delta INT,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_alerts_project ON rank_alerts(project_id, acknowledged, created_at DESC);

ALTER TABLE rank_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_alerts_all ON rank_alerts;
CREATE POLICY rank_alerts_all ON rank_alerts FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0025_scale.sql ==========

-- Phase 9: Keyword + audit scale
-- Crawl/finding diff snapshots (new/fixed/regressed) + async bulk keyword jobs.

CREATE TABLE IF NOT EXISTS finding_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  fixed_count INT NOT NULL DEFAULT 0,
  regressed_count INT NOT NULL DEFAULT 0,
  new_titles JSONB DEFAULT '[]',
  fixed_titles JSONB DEFAULT '[]',
  regressed_titles JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finding_snapshots_project ON finding_snapshots(project_id, created_at DESC);

ALTER TABLE finding_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finding_snapshots_all ON finding_snapshots;
CREATE POLICY finding_snapshots_all ON finding_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE TABLE IF NOT EXISTS keyword_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seeds JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_seeds INT NOT NULL DEFAULT 0,
  processed_seeds INT NOT NULL DEFAULT 0,
  keywords_found INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_keyword_jobs_project ON keyword_jobs(project_id, created_at DESC);

ALTER TABLE keyword_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS keyword_jobs_all ON keyword_jobs;
CREATE POLICY keyword_jobs_all ON keyword_jobs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0026_alerts_api.sql ==========

-- Phase 11: Alerts, annotations & public API.

-- Annotations: correlate movement to actions ("published X", "shipped fix").
CREATE TABLE IF NOT EXISTS annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  label TEXT NOT NULL,
  annotation_type TEXT NOT NULL DEFAULT 'note'
    CHECK (annotation_type IN ('note', 'publish', 'fix', 'campaign', 'algo_update')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_annotations_project ON annotations(project_id, date DESC);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS annotations_all ON annotations;
CREATE POLICY annotations_all ON annotations FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- API keys for the public API (batch + read endpoints). Only the hash is stored.
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'API key',
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id, revoked);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_keys_all ON api_keys;
CREATE POLICY api_keys_all ON api_keys FOR ALL
  USING (organization_id IN (SELECT get_user_org_ids()));


-- ========== 0027_local_seo.sql ==========

-- Phase 12: Local SEO domination.

-- Map-grid (Local Falcon style) scan results: one row per grid scan, cells in JSONB.
CREATE TABLE IF NOT EXISTS local_grid_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  center_lat NUMERIC,
  center_lng NUMERIC,
  grid_size INT NOT NULL DEFAULT 5,
  radius_km NUMERIC NOT NULL DEFAULT 2,
  avg_rank NUMERIC,
  found_cells INT NOT NULL DEFAULT 0,
  total_cells INT NOT NULL DEFAULT 0,
  cells JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_local_grid_project ON local_grid_scans(project_id, created_at DESC);

ALTER TABLE local_grid_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS local_grid_all ON local_grid_scans;
CREATE POLICY local_grid_all ON local_grid_scans FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Review velocity snapshots per platform.
CREATE TABLE IF NOT EXISTS review_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'google',
  rating NUMERIC,
  review_count INT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_snapshots_project ON review_snapshots(project_id, platform, captured_at DESC);

ALTER TABLE review_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_snapshots_all ON review_snapshots;
CREATE POLICY review_snapshots_all ON review_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0028_reputation.sql ==========

-- Phase 14: Brand & reputation monitoring.

CREATE TABLE IF NOT EXISTS brand_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'web',
  url TEXT NOT NULL,
  title TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'unknown')),
  sentiment_score NUMERIC,
  is_unlinked BOOLEAN NOT NULL DEFAULT false,
  mention_type TEXT NOT NULL DEFAULT 'brand',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_brand_mentions_project ON brand_mentions(project_id, captured_at DESC);

ALTER TABLE brand_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brand_mentions_all ON brand_mentions;
CREATE POLICY brand_mentions_all ON brand_mentions FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0029_topical.sql ==========

-- Phase 15: Topical authority & content architecture.

CREATE TABLE IF NOT EXISTS topical_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  hubs JSONB NOT NULL DEFAULT '[]',
  hub_count INT NOT NULL DEFAULT 0,
  spoke_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topical_maps_project ON topical_maps(project_id, created_at DESC);

ALTER TABLE topical_maps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS topical_maps_all ON topical_maps;
CREATE POLICY topical_maps_all ON topical_maps FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0030_indexation.sql ==========

-- Phase 17: Indexation & AI-crawler intelligence.

CREATE TABLE IF NOT EXISTS index_coverage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  confidence NUMERIC,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_index_coverage_project ON index_coverage_items(project_id, action);

ALTER TABLE index_coverage_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS index_coverage_items_all ON index_coverage_items;
CREATE POLICY index_coverage_items_all ON index_coverage_items FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE TABLE IF NOT EXISTS crawler_log_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_lines INT NOT NULL DEFAULT 0,
  parsed_hits INT NOT NULL DEFAULT 0,
  ai_bots_seen TEXT[] DEFAULT '{}',
  search_bots_seen TEXT[] DEFAULT '{}',
  report JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawler_log_reports_project ON crawler_log_reports(project_id, created_at DESC);

ALTER TABLE crawler_log_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crawler_log_reports_all ON crawler_log_reports;
CREATE POLICY crawler_log_reports_all ON crawler_log_reports FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Per-URL index status tracking on the existing indexing log.
ALTER TABLE url_indexing_log
  ADD COLUMN IF NOT EXISTS index_status TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;


-- ========== 0031_distribution.sql ==========

-- Phase 18: Distribution & publishing lifecycle tracking.

CREATE TABLE IF NOT EXISTS distribution_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES content_assets(id) ON DELETE SET NULL,
  destination TEXT NOT NULL, -- wordpress | webflow | shopify | ghost | linkedin | x | reddit | quora | youtube | newsletter | gbp | directory
  stage TEXT NOT NULL DEFAULT 'drafted'
    CHECK (stage IN ('drafted','approved','scheduled','published','indexed','ranking','cited','getting_leads','needs_refresh','failed')),
  scheduled_at TIMESTAMPTZ,
  published_url TEXT,
  external_id TEXT,
  stage_history JSONB NOT NULL DEFAULT '[]',
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distribution_jobs_project ON distribution_jobs(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_distribution_jobs_asset ON distribution_jobs(asset_id);

ALTER TABLE distribution_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS distribution_jobs_all ON distribution_jobs;
CREATE POLICY distribution_jobs_all ON distribution_jobs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_distribution_jobs_updated ON distribution_jobs;
CREATE TRIGGER trg_distribution_jobs_updated
  BEFORE UPDATE ON distribution_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ========== 0032_serp_capture.sql ==========

-- Phase 19: SERP feature capture tracking.

CREATE TABLE IF NOT EXISTS snippet_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  feature TEXT NOT NULL,
  current_position INT,
  recommended_format TEXT,
  owned BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword, feature)
);

CREATE INDEX IF NOT EXISTS idx_snippet_opps_project ON snippet_opportunities(project_id, owned);

ALTER TABLE snippet_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snippet_opportunities_all ON snippet_opportunities;
CREATE POLICY snippet_opportunities_all ON snippet_opportunities FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0033_roi.sql ==========

-- Phase 21: ROI command center — project settings (UX layer config, etc.)

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';


-- ========== 0034_operating.sql ==========

-- Phase 22: Onboarding, guarantee & continuous optimization loop.
-- operating_plans: onboarding output (business model + master competitor list +
--   keyword universe + 90-day plan) generated from the objective wizard.
-- operating_reviews: daily/weekly/monthly/quarterly cadence digests (gainers/
--   losers, decay, regressions, citation gaps) with tasks created.

CREATE TABLE IF NOT EXISTS operating_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_model JSONB NOT NULL DEFAULT '{}',
  competitor_universe JSONB NOT NULL DEFAULT '[]',
  keyword_universe JSONB NOT NULL DEFAULT '[]',
  plan JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_operating_plans_project ON operating_plans(project_id);

ALTER TABLE operating_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operating_plans_all ON operating_plans;
CREATE POLICY operating_plans_all ON operating_plans FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE TABLE IF NOT EXISTS operating_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL,
  digest JSONB NOT NULL DEFAULT '{}',
  tasks_created INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operating_reviews_project ON operating_reviews(project_id, created_at DESC);

ALTER TABLE operating_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operating_reviews_all ON operating_reviews;
CREATE POLICY operating_reviews_all ON operating_reviews FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0035_provenance_provider.sql ==========

-- Trust Spine completion: every provenance-bearing table also records WHICH
-- provider produced the value and, on failure, WHY it is unavailable. This lets
-- the UI/report show "source: X, last checked: Y" and never present a failed
-- provider call as a confident measured value.

ALTER TABLE technical_findings
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE visibility_results
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE authority_opportunities
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE attribution_metrics
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;


-- ========== 0036_rank_frequency.sql ==========

-- Opt-in daily rank tracking. Defaults OFF so existing projects keep the
-- weekly cadence (and weekly SERP spend); agencies/pro plans can flip this on
-- per project for volatile money keywords.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS daily_rank_tracking BOOLEAN NOT NULL DEFAULT false;


-- ========== 0037_behavior.sql ==========

-- Phase 1 (100X): Microsoft Clarity behavioral analytics.
-- Per-URL behavioral metrics with provenance. Refund-safety: rows are only
-- written when Clarity returns real data (data_source = 'measured').

CREATE TABLE IF NOT EXISTS behavior_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sessions INT NOT NULL DEFAULT 0,
  scroll_depth_pct NUMERIC,
  engagement_time_sec NUMERIC,
  dead_clicks INT NOT NULL DEFAULT 0,
  rage_clicks INT NOT NULL DEFAULT 0,
  quickbacks INT NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'measured'
    CHECK (data_source IN ('measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable')),
  provider TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_behavior_metrics_project ON behavior_metrics(project_id, sessions DESC);

ALTER TABLE behavior_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS behavior_metrics_all ON behavior_metrics;
CREATE POLICY behavior_metrics_all ON behavior_metrics FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0038_pgvector.sql ==========

-- Phase 3 (100X): local semantic engine — pgvector storage for keyless
-- all-MiniLM-L6-v2 (384-dim) embeddings computed by OmniData.
-- The extension is optional; if a managed Postgres lacks it the app still works
-- (semantic features report `available:false`). Guarded so a missing extension
-- does not abort the whole migration batch.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension unavailable; semantic storage disabled';
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS content_embeddings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'page',          -- page | keyword | title
      ref TEXT NOT NULL,                           -- url / keyword / id
      content_hash TEXT,
      embedding vector(384),
      model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (project_id, kind, ref)
    );

    CREATE INDEX IF NOT EXISTS idx_content_embeddings_project ON content_embeddings(project_id, kind);

    ALTER TABLE content_embeddings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS content_embeddings_all ON content_embeddings;
    CREATE POLICY content_embeddings_all ON content_embeddings FOR ALL
      USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
  END IF;
END$$;


-- ========== 0039_deep_crawl.sql ==========

-- Phase 4 (100X): deep technical crawl (Screaming-Frog-class) storage.

CREATE TABLE IF NOT EXISTS crawl_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status INT NOT NULL DEFAULT 0,
  depth INT NOT NULL DEFAULT 0,
  title TEXT,
  meta_description TEXT,
  h1_count INT NOT NULL DEFAULT 0,
  canonical TEXT,
  noindex BOOLEAN NOT NULL DEFAULT false,
  word_count INT NOT NULL DEFAULT 0,
  internal_links INT NOT NULL DEFAULT 0,
  external_links INT NOT NULL DEFAULT 0,
  redirect_hops INT NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawl_pages_project ON crawl_pages(project_id, status);

CREATE TABLE IF NOT EXISTS crawl_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  detail TEXT,
  urls JSONB NOT NULL DEFAULT '[]',
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawl_issues_project ON crawl_issues(project_id, severity);

ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crawl_pages_all ON crawl_pages;
CREATE POLICY crawl_pages_all ON crawl_pages FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS crawl_issues_all ON crawl_issues;
CREATE POLICY crawl_issues_all ON crawl_issues FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0040_cwv_history.sql ==========

-- Phase 7 (100X): Core Web Vitals history (CrUX real-user p75 trends).

CREATE TABLE IF NOT EXISTS cwv_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collected_on DATE NOT NULL,
  lcp_ms INT,
  inp_ms INT,
  cls NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, collected_on)
);

CREATE INDEX IF NOT EXISTS idx_cwv_history_project ON cwv_history(project_id, collected_on);

ALTER TABLE cwv_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cwv_history_all ON cwv_history;
CREATE POLICY cwv_history_all ON cwv_history FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0041_mention_firehose.sql ==========

-- Phase 14 (100X): Social & community mention firehose.
-- Extend allowed platforms to include the broader free/keyless sources.

ALTER TABLE community_mentions DROP CONSTRAINT IF EXISTS community_mentions_platform_check;
ALTER TABLE community_mentions
  ADD CONSTRAINT community_mentions_platform_check
  CHECK (platform IN (
    'reddit', 'quora', 'hacker_news', 'github',
    'stackexchange', 'producthunt', 'mastodon', 'bluesky', 'wikipedia',
    'other'
  ));


-- ========== 0042_provenance_rank_mentions.sql ==========

-- Provenance hardening: rank_snapshots and brand_mentions are real measurements
-- but were written without the standard provenance fields the rest of the
-- platform uses. Add them (additive, idempotent) so every metric row carries
-- data_source / confidence / last_checked_at and refund-safety holds end-to-end.

ALTER TABLE rank_snapshots
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE brand_mentions
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;


-- ========== 0043_rank_source.sql ==========

-- First-party trusted-source routing for rank tracking. When Search Console is
-- connected, the tracked position comes from the user's own measured ranking
-- (first_party) instead of a public SERP scrape (public_serp). Persist the
-- source, confidence, and the public SERP position alongside it so the UI can
-- label each keyword honestly and pros can cross-check against Search Console.

ALTER TABLE rank_keywords
  ADD COLUMN IF NOT EXISTS last_rank_source TEXT,
  ADD COLUMN IF NOT EXISTS last_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_public_position INTEGER;


-- ========== 0044_ai_probe_traces.sql ==========

-- AEO/LLM prompt observability: one auditable row per prompt×engine probe.
-- This is the proof + "magic" history — a per-prompt win/loss timeline showing
-- when the brand was mentioned/cited vs when competitors won, with the model,
-- grounding mode, cited sources, and a response excerpt for evidence.

CREATE TABLE IF NOT EXISTS ai_probe_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID,
  prompt_id UUID,
  engine TEXT NOT NULL,
  prompt TEXT NOT NULL,
  persona TEXT,
  response_excerpt TEXT,
  brand_mentioned BOOLEAN NOT NULL DEFAULT false,
  brand_cited BOOLEAN NOT NULL DEFAULT false,
  cited_sources TEXT[] NOT NULL DEFAULT '{}',
  competitors_mentioned TEXT[] NOT NULL DEFAULT '{}',
  model TEXT,
  grounding_mode TEXT,
  confidence NUMERIC,
  data_source TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_probe_traces_project ON ai_probe_traces(project_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_probe_traces_prompt ON ai_probe_traces(project_id, prompt);
CREATE INDEX IF NOT EXISTS idx_ai_probe_traces_engine ON ai_probe_traces(project_id, engine);

ALTER TABLE ai_probe_traces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_probe_traces_all ON ai_probe_traces;
CREATE POLICY ai_probe_traces_all ON ai_probe_traces FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0045_merchant.sql ==========

-- Merchant / Shopping vertical: store the parsed + audited product feed so the
-- UI can show feed-quality scores, top issues, and LLM-optimized titles/
-- descriptions, and so feed issues can be tracked as execution_tasks.

CREATE TABLE IF NOT EXISTS merchant_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  optimized_title TEXT,
  optimized_description TEXT,
  brand TEXT,
  price TEXT,
  issues JSONB NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  json_ld JSONB,
  data_source TEXT NOT NULL DEFAULT 'measured',
  audited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_products_project ON merchant_products(project_id, score);

ALTER TABLE merchant_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_products_all ON merchant_products;
CREATE POLICY merchant_products_all ON merchant_products FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0046_api_spend.sql ==========

-- Global LLM / paid-API spend ledger for the cost guard.
-- Tracks estimated USD spend per day+provider so the app can enforce a hard
-- daily/monthly budget across all callers (scans, public audits, crons) and
-- never run up an unbounded API bill. This is intentionally global (not
-- org-scoped) — it protects the platform owner's provider accounts.

CREATE TABLE IF NOT EXISTS api_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  provider text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  est_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, provider)
);

CREATE INDEX IF NOT EXISTS api_spend_daily_day_idx ON api_spend_daily (day);

-- Only the service role touches this ledger; RLS on with no public policies.
ALTER TABLE api_spend_daily ENABLE ROW LEVEL SECURITY;

-- Atomic increment so concurrent LLM calls can't lose updates (race-free budget).
CREATE OR REPLACE FUNCTION increment_api_spend(
  p_day date,
  p_provider text,
  p_calls integer,
  p_in bigint,
  p_out bigint,
  p_cost numeric
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO api_spend_daily (day, provider, calls, input_tokens, output_tokens, est_cost_usd, updated_at)
  VALUES (p_day, p_provider, p_calls, p_in, p_out, p_cost, now())
  ON CONFLICT (day, provider) DO UPDATE SET
    calls = api_spend_daily.calls + EXCLUDED.calls,
    input_tokens = api_spend_daily.input_tokens + EXCLUDED.input_tokens,
    output_tokens = api_spend_daily.output_tokens + EXCLUDED.output_tokens,
    est_cost_usd = api_spend_daily.est_cost_usd + EXCLUDED.est_cost_usd,
    updated_at = now();
$$;


-- ========== 0047_agent_analytics.sql ==========

-- Agent Analytics: log of AI crawler/agent hits on the customer's site.
-- This is the leading indicator of citation — AI engines must fetch your pages
-- (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot, …) before
-- they can cite you. Ingested keyless via a tracking beacon or a server/CDN log
-- paste, then aggregated into bot-by-bot crawl frequency, purpose mix, and the
-- most-crawled paths. Profound gates this behind enterprise CDN integrations;
-- we offer it open.

CREATE TABLE IF NOT EXISTS ai_crawler_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bot TEXT NOT NULL,
  vendor TEXT NOT NULL,
  purpose TEXT NOT NULL,
  path TEXT,
  status_code INT,
  user_agent TEXT,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_project ON ai_crawler_hits(project_id, hit_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_bot ON ai_crawler_hits(project_id, bot);
CREATE INDEX IF NOT EXISTS idx_ai_crawler_hits_vendor ON ai_crawler_hits(project_id, vendor);

ALTER TABLE ai_crawler_hits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_crawler_hits_all ON ai_crawler_hits;
CREATE POLICY ai_crawler_hits_all ON ai_crawler_hits FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0048_source_graph.sql ==========

-- Source/Citation Graph (Phase 23 / manifest v24, Wave A).
--
-- The Ahrefs + Profound killer: a traversable graph of how AI answers are formed
-- in a customer's specific market. Built from the already-MEASURED citation data
-- (citation_sources, ai_probe_traces, visibility_results) into normalized
-- dimensions + typed edges:
--
--   prompt_cluster -> prompt -> engine -> cited source domain -> competitor / page
--
-- Unlike a generic backlink index, this is market-specific and answers: "who does
-- AI learn from in THIS niche, who is cited, where is the brand absent, and which
-- source, if influenced, would change the answer?" Every row carries provenance.

-- Intent-grouped clusters of tracked prompts (so SoV/demand roll up by theme).
CREATE TABLE IF NOT EXISTS prompt_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'informational',
  prompt_count INT NOT NULL DEFAULT 0,
  member_prompts JSONB NOT NULL DEFAULT '[]'::jsonb,
  demand_index NUMERIC,
  share_of_voice NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured',
  confidence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, label)
);

-- Normalized source-domain dimension with influence scoring.
CREATE TABLE IF NOT EXISTS source_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other',
  ai_citation_count INT NOT NULL DEFAULT 0,
  serp_rank_count INT NOT NULL DEFAULT 0,
  competitor_mention_count INT NOT NULL DEFAULT 0,
  brand_mention_count INT NOT NULL DEFAULT 0,
  authority NUMERIC,
  authority_source TEXT,
  reachability NUMERIC,
  conversion_value NUMERIC,
  influence_score NUMERIC NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_source TEXT NOT NULL DEFAULT 'measured',
  confidence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, domain)
);

-- Per-mention facts: a source cited (or ranked) for a prompt on an engine.
CREATE TABLE IF NOT EXISTS source_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_domain TEXT NOT NULL,
  source_url TEXT,
  engine TEXT NOT NULL,
  prompt_text TEXT,
  prompt_cluster_id UUID REFERENCES prompt_clusters(id) ON DELETE SET NULL,
  cites_brand BOOLEAN NOT NULL DEFAULT false,
  cites_competitor BOOLEAN NOT NULL DEFAULT false,
  competitor_name TEXT,
  position INT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_source TEXT NOT NULL DEFAULT 'measured',
  confidence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Derived, ranked fix list: influence-weighted citation/source opportunities.
CREATE TABLE IF NOT EXISTS source_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_domain TEXT NOT NULL,
  opportunity_type TEXT NOT NULL DEFAULT 'citation_gap',
  competitor_citations INT NOT NULL DEFAULT 0,
  brand_present BOOLEAN NOT NULL DEFAULT false,
  difficulty INT NOT NULL DEFAULT 50,
  influence_score NUMERIC NOT NULL DEFAULT 0,
  tactic TEXT,
  recommended_action TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_source TEXT NOT NULL DEFAULT 'measured',
  confidence NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_domain, opportunity_type)
);

-- Typed graph edges (prompt/cluster/engine/domain/competitor/page nodes).
CREATE TABLE IF NOT EXISTS source_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  from_kind TEXT NOT NULL,
  from_key TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_key TEXT NOT NULL,
  weight NUMERIC NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, edge_type, from_key, to_key)
);

CREATE INDEX IF NOT EXISTS idx_prompt_clusters_project ON prompt_clusters(project_id);
CREATE INDEX IF NOT EXISTS idx_source_domains_project ON source_domains(project_id, influence_score DESC);
CREATE INDEX IF NOT EXISTS idx_source_mentions_project ON source_mentions(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_mentions_domain ON source_mentions(project_id, source_domain);
CREATE INDEX IF NOT EXISTS idx_source_opportunities_project ON source_opportunities(project_id, influence_score DESC);
CREATE INDEX IF NOT EXISTS idx_source_edges_project ON source_edges(project_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_source_edges_from ON source_edges(project_id, from_key);

ALTER TABLE prompt_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prompt_clusters_all ON prompt_clusters;
CREATE POLICY prompt_clusters_all ON prompt_clusters FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS source_domains_all ON source_domains;
CREATE POLICY source_domains_all ON source_domains FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS source_mentions_all ON source_mentions;
CREATE POLICY source_mentions_all ON source_mentions FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS source_opportunities_all ON source_opportunities;
CREATE POLICY source_opportunities_all ON source_opportunities FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS source_edges_all ON source_edges;
CREATE POLICY source_edges_all ON source_edges FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0049_product_visibility.sql ==========

-- Merchant / Product AI visibility (Phase 23 / manifest v24, Wave B).
--
-- Tracks whether the brand's products surface in (a) Google Shopping/organic SERP
-- and (b) AI product recommendations ("best <category>", "what should I buy…").
-- Complements merchant_products (feed QA) with actual measured product visibility
-- over time. SERP presence is `measured`; parametric AI recommendations are
-- labeled `model_knowledge` (honest — not a grounded UI capture).

CREATE TABLE IF NOT EXISTS product_visibility_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id TEXT,
  query TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'shopping_serp',
  engine TEXT NOT NULL,
  brand_present BOOLEAN NOT NULL DEFAULT false,
  position INT,
  competitors_present JSONB NOT NULL DEFAULT '[]'::jsonb,
  cited_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_source TEXT NOT NULL DEFAULT 'measured',
  confidence NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_visibility_project ON product_visibility_snapshots(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_visibility_surface ON product_visibility_snapshots(project_id, surface);

ALTER TABLE product_visibility_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_visibility_snapshots_all ON product_visibility_snapshots;
CREATE POLICY product_visibility_snapshots_all ON product_visibility_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0050_snapshots.sql ==========

-- Snapshots + data-quality normalization (Phase 23 / manifest v24, Wave E).
--
-- Point-in-time daily snapshots so trends (GSC, GBP, AI visibility) are real
-- measured history instead of recomputed-on-the-fly guesses, plus a per-project
-- data-quality score that quantifies how much of the platform is running on
-- measured (vs unavailable/estimated) signals. Every row carries provenance.

CREATE TABLE IF NOT EXISTS gsc_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  clicks INT,
  impressions INT,
  ctr NUMERIC,
  avg_position NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, captured_on)
);

CREATE TABLE IF NOT EXISTS gbp_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  avg_rank NUMERIC,
  found_cells INT,
  total_cells INT,
  coverage NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, captured_on)
);

CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  probe_count INT NOT NULL DEFAULT 0,
  mention_rate NUMERIC,
  citation_rate NUMERIC,
  grounded_rate NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, captured_on)
);

CREATE TABLE IF NOT EXISTS data_quality_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  quality_score NUMERIC NOT NULL DEFAULT 0,
  measured_signals INT NOT NULL DEFAULT 0,
  total_signals INT NOT NULL DEFAULT 0,
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, captured_on)
);

CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_project ON gsc_snapshots(project_id, captured_on DESC);
CREATE INDEX IF NOT EXISTS idx_gbp_snapshots_project ON gbp_snapshots(project_id, captured_on DESC);
CREATE INDEX IF NOT EXISTS idx_ai_visibility_snapshots_project ON ai_visibility_snapshots(project_id, captured_on DESC);
CREATE INDEX IF NOT EXISTS idx_data_quality_scores_project ON data_quality_scores(project_id, captured_on DESC);

ALTER TABLE gsc_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_visibility_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_quality_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gsc_snapshots_all ON gsc_snapshots;
CREATE POLICY gsc_snapshots_all ON gsc_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS gbp_snapshots_all ON gbp_snapshots;
CREATE POLICY gbp_snapshots_all ON gbp_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS ai_visibility_snapshots_all ON ai_visibility_snapshots;
CREATE POLICY ai_visibility_snapshots_all ON ai_visibility_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS data_quality_scores_all ON data_quality_scores;
CREATE POLICY data_quality_scores_all ON data_quality_scores FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0051_ai_capture_evidence.sql ==========

-- Wave N4 — Evidence artifact spine.
-- One auditable evidence record per measured AI/search probe: the raw answer, a
-- sha256 response_hash (tamper-evident), the REAL cited URLs/source domains, and
-- pointers to heavy artifacts (screenshot/DOM) stored in the private `ai-evidence`
-- bucket. This is what turns "trust me" into proof. visibility_results.evidence_url
-- points back here. Retention is capped per project by the app (cost control).

CREATE TABLE IF NOT EXISTS ai_capture_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID,
  prompt_id UUID,
  engine TEXT NOT NULL,
  -- api | ui | search_result | model_knowledge
  surface_type TEXT NOT NULL DEFAULT 'api',
  prompt TEXT NOT NULL,
  measurement_mode TEXT,
  response_hash TEXT NOT NULL,
  raw_answer TEXT,
  cited_urls TEXT[] NOT NULL DEFAULT '{}',
  source_domains TEXT[] NOT NULL DEFAULT '{}',
  screenshot_path TEXT,
  dom_path TEXT,
  evidence_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_project ON ai_capture_evidence(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_run ON ai_capture_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_hash ON ai_capture_evidence(response_hash);

ALTER TABLE ai_capture_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_capture_evidence_all ON ai_capture_evidence;
CREATE POLICY ai_capture_evidence_all ON ai_capture_evidence FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Private evidence bucket. Heavy artifacts (full answer JSON, screenshot PNG,
-- DOM HTML) are written by the service role and served via signed URLs — NOT
-- public, since they hold tenant measurement data.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-evidence',
  'ai-evidence',
  false,
  26214400,
  ARRAY['application/json', 'text/html', 'text/plain', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;


-- ========== 0052_ai_prompt_panels.sql ==========

-- Wave O1 — Prompt panels (statistical-rigor measurement units).
-- A panel is a curated cluster of prompts measured as a matrix:
-- engines × geos × personas × runs_per_prompt. Replaces one-off prompt reads
-- with repeatable, sample-size-gated measurement (the moat is the history).

CREATE TABLE IF NOT EXISTS ai_prompt_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Measurement matrix. Empty geos/personas => single default cell.
  geos TEXT[] NOT NULL DEFAULT '{}',
  personas TEXT[] NOT NULL DEFAULT '{}',
  engines TEXT[] NOT NULL DEFAULT '{}',
  runs_per_prompt INT NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_prompt_panel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id UUID NOT NULL REFERENCES ai_prompt_panels(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
  prompt_text TEXT NOT NULL,
  weight NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_panels_project ON ai_prompt_panels(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_panel_members_panel ON ai_prompt_panel_members(panel_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_panel_members_project ON ai_prompt_panel_members(project_id);

ALTER TABLE ai_prompt_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt_panel_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_prompt_panels_all ON ai_prompt_panels;
CREATE POLICY ai_prompt_panels_all ON ai_prompt_panels FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS ai_prompt_panel_members_all ON ai_prompt_panel_members;
CREATE POLICY ai_prompt_panel_members_all ON ai_prompt_panel_members FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0053_panel_runs.sql ==========

-- Wave O2/O3 — Panel run summaries + geo conditioning on probe traces.

-- Aggregated statistical summary of one panel run (Wilson CIs, SoV, volatility).
CREATE TABLE IF NOT EXISTS ai_panel_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id UUID NOT NULL REFERENCES ai_prompt_panels(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID,
  sample_size INT NOT NULL DEFAULT 0,
  sufficient_sample BOOLEAN NOT NULL DEFAULT false,
  mention_rate NUMERIC,
  mention_ci_low NUMERIC,
  mention_ci_high NUMERIC,
  citation_rate NUMERIC,
  share_of_voice NUMERIC,
  volatility_index NUMERIC,
  engines_measured INT NOT NULL DEFAULT 0,
  cells_total INT NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_panel_runs_panel ON ai_panel_runs(panel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_panel_runs_project ON ai_panel_runs(project_id, created_at DESC);

ALTER TABLE ai_panel_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_panel_runs_all ON ai_panel_runs;
CREATE POLICY ai_panel_runs_all ON ai_panel_runs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Geo conditioning recorded on each probe (persona already exists).
ALTER TABLE ai_probe_traces ADD COLUMN IF NOT EXISTS geo TEXT;


-- ========== 0054_ops_execution.sql ==========

-- Wave Q1/Q4 — real ops execution: capture the runner result, errors, the
-- published URL, attempt count, and a shared task_id for the proof chain.

ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS task_id UUID;

CREATE INDEX IF NOT EXISTS idx_ops_queue_task ON ops_queue(task_id);


-- ========== 0055_proof_chain.sql ==========

-- Wave Q4 — per-asset proof chain: a shared task_id threads
-- execution_tasks → ops_queue → content_assets → results_ledger, and every
-- action carries a projected business impact.

ALTER TABLE results_ledger ADD COLUMN IF NOT EXISTS task_id UUID;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS task_id UUID;
ALTER TABLE execution_tasks ADD COLUMN IF NOT EXISTS impact_estimate JSONB;

CREATE INDEX IF NOT EXISTS idx_results_ledger_task ON results_ledger(task_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_task ON content_assets(task_id);


-- ========== 0056_generators.sql ==========

-- Wave Q5 — new content asset types for the alternative-page generator and the
-- server-side llms.txt pipeline.

ALTER TYPE content_asset_type ADD VALUE IF NOT EXISTS 'alternative_page';
ALTER TYPE content_asset_type ADD VALUE IF NOT EXISTS 'llms_txt';


-- ========== 0057_backlink_graph.sql ==========

-- Wave R2 — URL-level Presence Backlink Graph rollup snapshots.
-- The authoritative URL-level edges (with first/last seen) live in the OmniData
-- DuckDB store; this is the per-project temporal rollup for UI/history: total /
-- new / lost / toxic counts plus the top scored links and competitor intersection.

CREATE TABLE IF NOT EXISTS backlink_graph_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_links INT NOT NULL DEFAULT 0,
  referring_domains INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  lost_count INT NOT NULL DEFAULT 0,
  toxic_count INT NOT NULL DEFAULT 0,
  nofollow_count INT NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'unavailable',
  top_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  intersection JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backlink_graph_snapshots_project
  ON backlink_graph_snapshots(project_id, created_at DESC);

ALTER TABLE backlink_graph_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS backlink_graph_snapshots_org ON backlink_graph_snapshots;
CREATE POLICY backlink_graph_snapshots_org ON backlink_graph_snapshots FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);


-- ========== 0058_perf_indexes.sql ==========

-- 0058_perf_indexes.sql
-- Production hardening: indexes for hot queries introduced by the per-tenant
-- surface-measurement budget firewall and proof-chain reads.

-- The daily tenant budget check (assertTenantSurfaceBudget) filters api_usage by
-- (organization_id, created_at >= day-start) on every paid scan/panel trigger.
-- The existing single-column idx_api_usage_org can't serve the time range
-- efficiently; a composite index keeps the firewall cheap under load.
CREATE INDEX IF NOT EXISTS idx_api_usage_org_created
  ON api_usage(organization_id, created_at DESC);

-- ops_queue is polled by status for the executor and read by task_id for the
-- proof chain; a composite (organization_id, status) index speeds the worker's
-- "next pending item for this org" scan.
CREATE INDEX IF NOT EXISTS idx_ops_queue_org_status
  ON ops_queue(organization_id, status);


-- ========== 0059_measurement_evidence.sql ==========

-- Phase 1 (presence-os-110) — first-class measurement evidence.
-- Generalizes the AI-capture evidence spine (ai_capture_evidence) to EVERY
-- measured capability (SERP, rank, backlink graph, pagespeed, tech, ...), so any
-- user-facing number can be traced to a reproducible, tamper-evident record:
-- the source URL, the provider that produced it, the parser version, a sha256 of
-- the raw payload, the provenance/confidence, and (best-effort) the full raw
-- payload in the private ai-evidence storage bucket.

CREATE TABLE IF NOT EXISTS measurement_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- serp | rank | backlink_graph | pagespeed | tech | keyword | local | ...
  capability TEXT NOT NULL,
  -- what was measured: a keyword, URL, or domain
  target TEXT NOT NULL,
  -- which sovereign/provider produced the value (serper, omnidata, pagespeed, gsc, ...)
  provider TEXT,
  -- canonical source location (SERP url, audited page url) for reproducibility
  source_url TEXT,
  -- engine/parser version so a re-run is comparable
  parser_version TEXT,
  -- provenance: measured | estimated | model_knowledge | simulated | unavailable
  data_source TEXT NOT NULL DEFAULT 'measured',
  -- 0..1 confidence in the value
  confidence NUMERIC,
  -- sha256 of the raw payload (tamper-evident fingerprint)
  response_hash TEXT NOT NULL,
  -- small bounded structured excerpt of the result (never the full payload)
  payload_excerpt JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- storage path of the full raw artifact (signed-URL-able), or null
  evidence_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurement_evidence_project
  ON measurement_evidence(project_id, capability, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_measurement_evidence_hash
  ON measurement_evidence(response_hash);

ALTER TABLE measurement_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS measurement_evidence_org ON measurement_evidence;
CREATE POLICY measurement_evidence_org ON measurement_evidence FOR ALL USING (
  project_id IN (
    SELECT p.id FROM projects p
    JOIN memberships m ON m.organization_id = p.organization_id
    WHERE m.user_id = auth.uid()
  )
);


-- ========== 0060_keyword_corpus.sql ==========

-- Phase 3: keyword corpus foundation.
-- Stores normalized keyword candidates used by scanners, planners, and ranking schedules.

CREATE TABLE IF NOT EXISTS keyword_corpus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  normalized_keyword TEXT GENERATED ALWAYS AS (lower(trim(keyword))) STORED,
  locale TEXT NOT NULL DEFAULT 'en-US',
  country_code TEXT,
  intent TEXT,
  source TEXT NOT NULL DEFAULT 'seed',
  cluster_key TEXT,
  volume_estimate INT,
  difficulty_estimate INT,
  cpc_estimate NUMERIC(10, 2),
  trend JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_measured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_keyword, locale, country_code)
);

CREATE INDEX IF NOT EXISTS idx_keyword_corpus_project_active
  ON keyword_corpus(project_id, is_active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_corpus_cluster
  ON keyword_corpus(project_id, cluster_key);

ALTER TABLE keyword_corpus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS keyword_corpus_all ON keyword_corpus;
CREATE POLICY keyword_corpus_all ON keyword_corpus FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_keyword_corpus_updated ON keyword_corpus;
CREATE TRIGGER trg_keyword_corpus_updated
  BEFORE UPDATE ON keyword_corpus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ========== 0061_rank_schedules.sql ==========

-- Phase 3: rank schedules for recurring rank checks and auditability.

CREATE TABLE IF NOT EXISTS rank_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'default',
  cadence TEXT NOT NULL DEFAULT 'daily'
    CHECK (cadence IN ('hourly', 'daily', 'weekly', 'monthly', 'manual')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  run_hour SMALLINT,
  run_day_of_week SMALLINT,
  run_day_of_month SMALLINT,
  include_local_pack BOOLEAN NOT NULL DEFAULT true,
  include_ai_surfaces BOOLEAN NOT NULL DEFAULT true,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS rank_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES rank_schedules(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_summary JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_schedules_project_active
  ON rank_schedules(project_id, is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_rank_schedule_runs_schedule
  ON rank_schedule_runs(schedule_id, created_at DESC);

ALTER TABLE rank_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_schedule_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_schedules_all ON rank_schedules;
CREATE POLICY rank_schedules_all ON rank_schedules FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS rank_schedule_runs_all ON rank_schedule_runs;
CREATE POLICY rank_schedule_runs_all ON rank_schedule_runs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_rank_schedules_updated ON rank_schedules;
CREATE TRIGGER trg_rank_schedules_updated
  BEFORE UPDATE ON rank_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ========== 0062_traffic_panel.sql ==========

-- Phase 8: opt-in traffic panel observations (Layer 2 honest traffic intel).

CREATE TABLE IF NOT EXISTS traffic_panel_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  visits INT,
  unique_visitors INT,
  pageviews INT,
  source TEXT NOT NULL DEFAULT 'pixel'
    CHECK (source IN ('pixel', 'wordpress_plugin', 'agency_opt_in', 'manual')),
  provenance TEXT NOT NULL DEFAULT 'panel_observed'
    CHECK (provenance IN ('panel_observed', 'first_party_measured', 'unavailable')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_panel_project_period
  ON traffic_panel_observations(project_id, period_end DESC);

ALTER TABLE traffic_panel_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS traffic_panel_observations_all ON traffic_panel_observations;
CREATE POLICY traffic_panel_observations_all ON traffic_panel_observations FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Per-keyword rank schedule targets (extends 0061 project schedules).
CREATE TABLE IF NOT EXISTS rank_schedule_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES rank_schedules(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES rank_keywords(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'United States',
  device TEXT NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile')),
  geo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, keyword, location, device)
);

CREATE INDEX IF NOT EXISTS idx_rank_schedule_keywords_schedule
  ON rank_schedule_keywords(schedule_id, is_active);

ALTER TABLE rank_schedule_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_schedule_keywords_all ON rank_schedule_keywords;
CREATE POLICY rank_schedule_keywords_all ON rank_schedule_keywords FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));


-- ========== 0063_intelligence_reports.sql ==========

-- Deep Intelligence Report: type, section config, async generation status
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (report_type IN ('standard', 'deep')),
  ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS html_url TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_project_status ON reports(project_id, status, created_at DESC);


-- ========== 0064_audit_leads_org.sql ==========

-- Scope audit leads per organization (agency funnel isolation)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS audit_referral_token TEXT UNIQUE
    DEFAULT encode(gen_random_bytes(16), 'hex');

UPDATE organizations
SET audit_referral_token = encode(gen_random_bytes(16), 'hex')
WHERE audit_referral_token IS NULL;

ALTER TABLE organizations
  ALTER COLUMN audit_referral_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_audit_referral_token
  ON organizations(audit_referral_token);

ALTER TABLE audit_leads
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_leads_org ON audit_leads(organization_id, created_at DESC);

DROP POLICY IF EXISTS audit_leads_select_admin ON audit_leads;

-- Only org owners/admins see leads attributed to their organization
CREATE POLICY audit_leads_select_org_admin ON audit_leads
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );


-- ========== 0065_data_source_constraints.sql ==========

-- Platform-wide data_source CHECK constraints (trust spine enforcement at DB layer).

-- Full 5-value provenance enum (nullable columns allow NULL).
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'visibility_results',
    'technical_findings',
    'coverage_items',
    'authority_opportunities',
    'scores',
    'keyword_opportunities',
    'attribution_metrics',
    'cwv_history',
    'deep_crawl_pages',
    'deep_crawl_issues',
    'gsc_snapshots',
    'ga4_snapshots',
    'bing_snapshots',
    'rank_snapshots',
    'product_visibility_snapshots',
    'source_graph_nodes',
    'source_graph_edges',
    'source_influence_scores',
    'citation_authority_scores',
    'merchant_listings',
    'ai_probe_traces',
    'rank_keywords',
    'rank_history',
    'measurement_evidence',
    'backlink_graph_edges',
    'traffic_panel_observations'
  ];
  full_check TEXT := $$data_source IS NULL OR data_source IN (
    'measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable'
  )$$;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_source_check');
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'data_source'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, t || '_data_source_check', full_check);
    END IF;
  END LOOP;
END $$;

-- NOT NULL tables with full enum (no NULL).
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'behavior_metrics',
    'backlink_graph_edges'
  ];
  full_check_nn TEXT := $$data_source IN (
    'measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable'
  )$$;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_data_source_check');
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'data_source'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)', t, t || '_data_source_check', full_check_nn);
    END IF;
  END LOOP;
END $$;

-- Legacy citation_sources: measured | simulated only.
ALTER TABLE citation_sources DROP CONSTRAINT IF EXISTS citation_sources_data_source_check;
ALTER TABLE citation_sources
  ADD CONSTRAINT citation_sources_data_source_check
  CHECK (data_source IN ('measured', 'simulated'));


-- ========== 0066_provider_telemetry.sql ==========

-- Provider adapter telemetry for bounded weekly recalibration (Wave 4).
CREATE TABLE IF NOT EXISTS public.provider_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  capability TEXT NOT NULL,
  provider TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  error_message TEXT,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_telemetry_provider_created_idx
  ON public.provider_telemetry (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_telemetry_org_created_idx
  ON public.provider_telemetry (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

ALTER TABLE public.provider_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_telemetry_org_read ON public.provider_telemetry
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Inserts are service-role / server only (no client INSERT policy).


-- ========== 0067_evidence_trace_id.sql ==========

-- Propagate request trace_id into evidence rows for end-to-end observability.
ALTER TABLE public.measurement_evidence
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE public.ai_capture_evidence
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE INDEX IF NOT EXISTS measurement_evidence_trace_idx
  ON public.measurement_evidence (trace_id)
  WHERE trace_id IS NOT NULL;


