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
