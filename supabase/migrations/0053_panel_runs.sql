-- Wave O2/O3 — Panel run summaries + geo conditioning on probe traces.

-- Aggregated statistical summary of one panel run (Wilson CIs, SoV, volatility).
CREATE TABLE IF NOT EXISTS ai_panel_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id UUID NOT NULL REFERENCES ai_prompt_panels(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID,
  sample_size INT NOT NULL DEFAULT 0,
  sufficient_sample BOOLEAN NOT NULL DEFAULT false,
  mention_rate NUMERIC,
  mention_ci_low NUMERIC,
  mention_ci_high NUMERIC,
  citation_rate NUMERIC,
  share_of_voice NUMERIC,
  volatility_index NUMERIC,
  engines_measured INT NOT NULL DEFAULT 0,
  cells_total INT NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_panel_runs_panel ON ai_panel_runs(panel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_panel_runs_project ON ai_panel_runs(project_id, created_at DESC);

ALTER TABLE ai_panel_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_panel_runs_all ON ai_panel_runs;
CREATE POLICY ai_panel_runs_all ON ai_panel_runs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Geo conditioning recorded on each probe (persona already exists).
ALTER TABLE ai_probe_traces ADD COLUMN IF NOT EXISTS geo TEXT;
