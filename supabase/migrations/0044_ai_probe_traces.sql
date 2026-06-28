-- AEO/LLM prompt observability: one auditable row per prompt×engine probe.
-- This is the proof + "magic" history — a per-prompt win/loss timeline showing
-- when the brand was mentioned/cited vs when competitors won, with the model,
-- grounding mode, cited sources, and a response excerpt for evidence.

CREATE TABLE IF NOT EXISTS ai_probe_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID,
  prompt_id UUID,
  engine TEXT NOT NULL,
  prompt TEXT NOT NULL,
  persona TEXT,
  response_excerpt TEXT,
  brand_mentioned BOOLEAN NOT NULL DEFAULT false,
  brand_cited BOOLEAN NOT NULL DEFAULT false,
  cited_sources TEXT[] NOT NULL DEFAULT '{}',
  competitors_mentioned TEXT[] NOT NULL DEFAULT '{}',
  model TEXT,
  grounding_mode TEXT,
  confidence NUMERIC,
  data_source TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_probe_traces_project ON ai_probe_traces(project_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_probe_traces_prompt ON ai_probe_traces(project_id, prompt);
CREATE INDEX IF NOT EXISTS idx_ai_probe_traces_engine ON ai_probe_traces(project_id, engine);

ALTER TABLE ai_probe_traces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_probe_traces_all ON ai_probe_traces;
CREATE POLICY ai_probe_traces_all ON ai_probe_traces FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
