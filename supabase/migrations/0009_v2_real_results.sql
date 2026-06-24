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
