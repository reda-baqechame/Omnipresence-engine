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
