-- Phase 8: Expert rank tracking depth
-- device + geo dimensions, surfaced SERP features, competitor overlay,
-- share-of-voice, cannibalization, brand-in-AI-Overview, and rank-drop alerts.

ALTER TABLE rank_keywords
  ADD COLUMN IF NOT EXISTS device TEXT NOT NULL DEFAULT 'desktop',
  ADD COLUMN IF NOT EXISTS last_serp_features JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cannibalization_urls JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS competitor_overlay JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS share_of_voice NUMERIC,
  ADD COLUMN IF NOT EXISTS brand_in_ai_overview BOOLEAN;

-- Allow the same keyword to be tracked per-device.
ALTER TABLE rank_keywords DROP CONSTRAINT IF EXISTS rank_keywords_project_id_keyword_location_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_keywords_unique
  ON rank_keywords(project_id, keyword, location, device);

ALTER TABLE rank_snapshots
  ADD COLUMN IF NOT EXISTS device TEXT,
  ADD COLUMN IF NOT EXISTS cannibalization_urls JSONB,
  ADD COLUMN IF NOT EXISTS competitor_overlay JSONB,
  ADD COLUMN IF NOT EXISTS share_of_voice NUMERIC,
  ADD COLUMN IF NOT EXISTS brand_in_ai_overview BOOLEAN;

CREATE TABLE IF NOT EXISTS rank_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES rank_keywords(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'rank_drop',
  previous_position INT,
  current_position INT,
  delta INT,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_alerts_project ON rank_alerts(project_id, acknowledged, created_at DESC);

ALTER TABLE rank_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_alerts_all ON rank_alerts;
CREATE POLICY rank_alerts_all ON rank_alerts FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
