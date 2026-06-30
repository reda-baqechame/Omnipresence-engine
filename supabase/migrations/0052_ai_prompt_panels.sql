-- Wave O1 — Prompt panels (statistical-rigor measurement units).
-- A panel is a curated cluster of prompts measured as a matrix:
-- engines × geos × personas × runs_per_prompt. Replaces one-off prompt reads
-- with repeatable, sample-size-gated measurement (the moat is the history).

CREATE TABLE IF NOT EXISTS ai_prompt_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  -- Measurement matrix. Empty geos/personas => single default cell.
  geos TEXT[] NOT NULL DEFAULT '{}',
  personas TEXT[] NOT NULL DEFAULT '{}',
  engines TEXT[] NOT NULL DEFAULT '{}',
  runs_per_prompt INT NOT NULL DEFAULT 3,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_prompt_panel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id UUID NOT NULL REFERENCES ai_prompt_panels(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL,
  prompt_text TEXT NOT NULL,
  weight NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_panels_project ON ai_prompt_panels(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_panel_members_panel ON ai_prompt_panel_members(panel_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_panel_members_project ON ai_prompt_panel_members(project_id);

ALTER TABLE ai_prompt_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt_panel_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_prompt_panels_all ON ai_prompt_panels;
CREATE POLICY ai_prompt_panels_all ON ai_prompt_panels FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS ai_prompt_panel_members_all ON ai_prompt_panel_members;
CREATE POLICY ai_prompt_panel_members_all ON ai_prompt_panel_members FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
