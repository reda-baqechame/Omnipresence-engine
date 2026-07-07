-- Phase 6: hub query performance indexes (idempotent)

CREATE INDEX IF NOT EXISTS idx_visibility_results_project_created
  ON visibility_results (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_keyword_checked
  ON rank_snapshots (keyword_id, checked_at DESC);
