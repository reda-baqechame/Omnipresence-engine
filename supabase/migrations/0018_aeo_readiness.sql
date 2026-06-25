-- Phase 10: 7-lever AEO Readiness snapshot per project

CREATE TABLE IF NOT EXISTS aeo_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  readiness_score NUMERIC NOT NULL DEFAULT 0,
  deterministic_score NUMERIC NOT NULL DEFAULT 0,
  probabilistic_score NUMERIC NOT NULL DEFAULT 0,
  levers JSONB NOT NULL DEFAULT '[]'::jsonb,
  deterministic_deliverables_met BOOLEAN NOT NULL DEFAULT false,
  next_best_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  domain_authority NUMERIC,
  page_speed_score NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_aeo_readiness_project ON aeo_readiness(project_id);

ALTER TABLE aeo_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY aeo_readiness_access ON aeo_readiness FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);
