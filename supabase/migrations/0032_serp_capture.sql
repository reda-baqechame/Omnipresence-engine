-- Phase 19: SERP feature capture tracking.

CREATE TABLE IF NOT EXISTS snippet_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  feature TEXT NOT NULL,
  current_position INT,
  recommended_format TEXT,
  owned BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword, feature)
);

CREATE INDEX IF NOT EXISTS idx_snippet_opps_project ON snippet_opportunities(project_id, owned);

ALTER TABLE snippet_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS snippet_opportunities_all ON snippet_opportunities;
CREATE POLICY snippet_opportunities_all ON snippet_opportunities FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
