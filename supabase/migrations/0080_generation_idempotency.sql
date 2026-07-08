-- Idempotency for report-generate and scan-trigger: double-clicking Generate
-- (or a retried client request) currently creates a second `reports` row /
-- triggers a second scan with no way to detect the duplicate. Mirrors the
-- existing webhook idempotency pattern (webhook_events UNIQUE(provider,
-- event_id), 0005_webhook_events.sql) — a client-generated key, scoped to
-- the project, deduplicated via a partial unique index so omitting the key
-- (existing callers) is unaffected.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS reports_project_idempotency_key
  ON reports(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE visibility_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS visibility_runs_project_idempotency_key
  ON visibility_runs(project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
