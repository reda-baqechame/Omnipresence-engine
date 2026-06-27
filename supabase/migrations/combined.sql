-- PresenceOS combined migration (41 files)
-- Generated 2026-06-27T14:28:54.732Z

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

CREATE POLICY guarantee_contracts_org_access ON guarantee_contracts
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY guarantee_claims_org_access ON guarantee_claims
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = auth.uid()
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


