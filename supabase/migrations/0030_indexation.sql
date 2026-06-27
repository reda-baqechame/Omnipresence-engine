-- Phase 17: Indexation & AI-crawler intelligence.

CREATE TABLE IF NOT EXISTS index_coverage_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  confidence NUMERIC,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_index_coverage_project ON index_coverage_items(project_id, action);

ALTER TABLE index_coverage_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS index_coverage_items_all ON index_coverage_items;
CREATE POLICY index_coverage_items_all ON index_coverage_items FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE TABLE IF NOT EXISTS crawler_log_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  total_lines INT NOT NULL DEFAULT 0,
  parsed_hits INT NOT NULL DEFAULT 0,
  ai_bots_seen TEXT[] DEFAULT '{}',
  search_bots_seen TEXT[] DEFAULT '{}',
  report JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawler_log_reports_project ON crawler_log_reports(project_id, created_at DESC);

ALTER TABLE crawler_log_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crawler_log_reports_all ON crawler_log_reports;
CREATE POLICY crawler_log_reports_all ON crawler_log_reports FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Per-URL index status tracking on the existing indexing log.
ALTER TABLE url_indexing_log
  ADD COLUMN IF NOT EXISTS index_status TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
