-- Phase 4: Execution Task Engine
-- One unified, tracked action model bridging technical findings, content/keyword
-- gaps, coverage gaps, authority opportunities, and roadmap items into tasks with
-- verified outcomes on re-scan.

CREATE TABLE IF NOT EXISTS execution_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  -- where this task came from: technical_finding | content_gap | keyword_opportunity
  -- | coverage_gap | authority | roadmap | manual
  source_module TEXT NOT NULL DEFAULT 'manual',
  -- loose reference to the originating row (no FK: source rows can be wiped on re-scan)
  source_id TEXT,
  category TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  impact INT NOT NULL DEFAULT 0,
  effort INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'verified', 'dismissed')),
  owner UUID REFERENCES profiles(id),
  due_date DATE,
  evidence JSONB DEFAULT '{}',
  generated_asset_id UUID,
  result_metric JSONB DEFAULT '{}',
  -- rescan verification linkage
  finding_resolved BOOLEAN,
  before_metric JSONB,
  after_metric JSONB,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_module, source_id)
);

CREATE INDEX IF NOT EXISTS idx_execution_tasks_project ON execution_tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_execution_tasks_priority ON execution_tasks(project_id, priority);

ALTER TABLE execution_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_tasks_all ON execution_tasks;
CREATE POLICY execution_tasks_all ON execution_tasks FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_execution_tasks_updated ON execution_tasks;
CREATE TRIGGER trg_execution_tasks_updated
  BEFORE UPDATE ON execution_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
