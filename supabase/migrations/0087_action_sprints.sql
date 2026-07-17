-- Weekly Action Sprints (Master Plan v4 Phase 2, Trakkr pattern):
-- a week's prioritized fixes drawn from measured gaps, with a visibility
-- baseline captured at start and an honest outcome verdict after remeasure.

CREATE TABLE IF NOT EXISTS action_sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'active', 'measuring', 'completed', 'skipped')),
  -- [{ title, category ('technical'|'content'|'sources'), source, fix, detail, done }]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { mention_rate, citation_rate, sample_size, captured_at }
  baseline JSONB,
  outcome JSONB,
  -- Honest five-state vocabulary: deployment verified / visibility increased /
  -- unchanged / declined / inconclusive (insufficient measured sample).
  outcome_verdict TEXT
    CHECK (outcome_verdict IN ('verified', 'increased', 'unchanged', 'declined', 'inconclusive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (project_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_action_sprints_project_week
  ON action_sprints (project_id, week_start DESC);

ALTER TABLE action_sprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_sprints_all ON action_sprints;
CREATE POLICY action_sprints_all ON action_sprints FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
