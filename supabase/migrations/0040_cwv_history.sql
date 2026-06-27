-- Phase 7 (100X): Core Web Vitals history (CrUX real-user p75 trends).

CREATE TABLE IF NOT EXISTS cwv_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  collected_on DATE NOT NULL,
  lcp_ms INT,
  inp_ms INT,
  cls NUMERIC,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, collected_on)
);

CREATE INDEX IF NOT EXISTS idx_cwv_history_project ON cwv_history(project_id, collected_on);

ALTER TABLE cwv_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cwv_history_all ON cwv_history;
CREATE POLICY cwv_history_all ON cwv_history FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
