-- Phase 8: opt-in traffic panel observations (Layer 2 honest traffic intel).

CREATE TABLE IF NOT EXISTS traffic_panel_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  visits INT,
  unique_visitors INT,
  pageviews INT,
  source TEXT NOT NULL DEFAULT 'pixel'
    CHECK (source IN ('pixel', 'wordpress_plugin', 'agency_opt_in', 'manual')),
  provenance TEXT NOT NULL DEFAULT 'panel_observed'
    CHECK (provenance IN ('panel_observed', 'first_party_measured', 'unavailable')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_panel_project_period
  ON traffic_panel_observations(project_id, period_end DESC);

ALTER TABLE traffic_panel_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS traffic_panel_observations_all ON traffic_panel_observations;
CREATE POLICY traffic_panel_observations_all ON traffic_panel_observations FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Per-keyword rank schedule targets (extends 0061 project schedules).
CREATE TABLE IF NOT EXISTS rank_schedule_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES rank_schedules(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES rank_keywords(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'United States',
  device TEXT NOT NULL DEFAULT 'desktop' CHECK (device IN ('desktop', 'mobile')),
  geo TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, keyword, location, device)
);

CREATE INDEX IF NOT EXISTS idx_rank_schedule_keywords_schedule
  ON rank_schedule_keywords(schedule_id, is_active);

ALTER TABLE rank_schedule_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_schedule_keywords_all ON rank_schedule_keywords;
CREATE POLICY rank_schedule_keywords_all ON rank_schedule_keywords FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
