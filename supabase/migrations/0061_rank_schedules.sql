-- Phase 3: rank schedules for recurring rank checks and auditability.

CREATE TABLE IF NOT EXISTS rank_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'default',
  cadence TEXT NOT NULL DEFAULT 'daily'
    CHECK (cadence IN ('hourly', 'daily', 'weekly', 'monthly', 'manual')),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  run_hour SMALLINT,
  run_day_of_week SMALLINT,
  run_day_of_month SMALLINT,
  include_local_pack BOOLEAN NOT NULL DEFAULT true,
  include_ai_surfaces BOOLEAN NOT NULL DEFAULT true,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS rank_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES rank_schedules(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_summary JSONB DEFAULT '{}',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_schedules_project_active
  ON rank_schedules(project_id, is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_rank_schedule_runs_schedule
  ON rank_schedule_runs(schedule_id, created_at DESC);

ALTER TABLE rank_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_schedule_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rank_schedules_all ON rank_schedules;
CREATE POLICY rank_schedules_all ON rank_schedules FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS rank_schedule_runs_all ON rank_schedule_runs;
CREATE POLICY rank_schedule_runs_all ON rank_schedule_runs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_rank_schedules_updated ON rank_schedules;
CREATE TRIGGER trg_rank_schedules_updated
  BEFORE UPDATE ON rank_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
