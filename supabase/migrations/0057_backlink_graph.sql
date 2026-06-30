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
