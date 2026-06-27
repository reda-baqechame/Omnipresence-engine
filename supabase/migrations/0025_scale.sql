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
