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
