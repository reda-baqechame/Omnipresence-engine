-- Phase 1 (100X): Microsoft Clarity behavioral analytics.
-- Per-URL behavioral metrics with provenance. Refund-safety: rows are only
-- written when Clarity returns real data (data_source = 'measured').

CREATE TABLE IF NOT EXISTS behavior_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sessions INT NOT NULL DEFAULT 0,
  scroll_depth_pct NUMERIC,
  engagement_time_sec NUMERIC,
  dead_clicks INT NOT NULL DEFAULT 0,
  rage_clicks INT NOT NULL DEFAULT 0,
  quickbacks INT NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'measured'
    CHECK (data_source IN ('measured', 'estimated', 'model_knowledge', 'simulated', 'unavailable')),
  provider TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_behavior_metrics_project ON behavior_metrics(project_id, sessions DESC);

ALTER TABLE behavior_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS behavior_metrics_all ON behavior_metrics;
CREATE POLICY behavior_metrics_all ON behavior_metrics FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
