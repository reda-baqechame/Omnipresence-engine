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
