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
