-- Wave Q4 — per-asset proof chain: a shared task_id threads
-- execution_tasks → ops_queue → content_assets → results_ledger, and every
-- action carries a projected business impact.

ALTER TABLE results_ledger ADD COLUMN IF NOT EXISTS task_id UUID;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS task_id UUID;
ALTER TABLE execution_tasks ADD COLUMN IF NOT EXISTS impact_estimate JSONB;

CREATE INDEX IF NOT EXISTS idx_results_ledger_task ON results_ledger(task_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_task ON content_assets(task_id);
