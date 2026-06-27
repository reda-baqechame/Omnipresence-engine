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
