-- SearchOps: persist GSC query/page rows from explicit refresh (not SSR live calls).
-- Enables SSR opportunity mining + auto-verify after metrics without re-hitting Google.

CREATE TABLE IF NOT EXISTS gsc_query_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  captured_on DATE NOT NULL DEFAULT CURRENT_DATE,
  dimension TEXT NOT NULL CHECK (dimension IN ('query', 'page')),
  key TEXT NOT NULL,
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  clicks INT,
  impressions INT,
  ctr NUMERIC,
  position NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured'
    CHECK (data_source IN ('measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, captured_on, dimension, key, range_start, range_end)
);

CREATE INDEX IF NOT EXISTS idx_gsc_query_snapshots_project_captured
  ON gsc_query_snapshots (project_id, captured_on DESC);

CREATE INDEX IF NOT EXISTS idx_gsc_query_snapshots_project_dim_key
  ON gsc_query_snapshots (project_id, dimension, key);

ALTER TABLE gsc_query_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gsc_query_snapshots_all ON gsc_query_snapshots;
CREATE POLICY gsc_query_snapshots_all ON gsc_query_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
