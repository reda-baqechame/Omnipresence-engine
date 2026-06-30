-- Wave Q1/Q4 — real ops execution: capture the runner result, errors, the
-- published URL, attempt count, and a shared task_id for the proof chain.

ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS result JSONB;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;
ALTER TABLE ops_queue ADD COLUMN IF NOT EXISTS task_id UUID;

CREATE INDEX IF NOT EXISTS idx_ops_queue_task ON ops_queue(task_id);
