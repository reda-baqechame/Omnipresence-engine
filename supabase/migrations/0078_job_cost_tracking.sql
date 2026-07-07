-- Per-job cost/token attribution: spend is currently tracked platform-wide
-- per day (api_spend_daily) and org-wide (api_usage), but nothing rolls it up
-- per report/scan, so "what did THIS report cost" is unanswerable. Add the
-- columns + atomic increment RPCs (mirrors increment_api_spend's pattern) and
-- report_id/run_id on provider_telemetry for per-call auditing.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_calls_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_step TEXT,
  ADD COLUMN IF NOT EXISTS progress_percent INTEGER;

ALTER TABLE visibility_runs
  ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_calls_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_step TEXT,
  ADD COLUMN IF NOT EXISTS progress_percent INTEGER;

ALTER TABLE provider_telemetry
  ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES visibility_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS provider_telemetry_report_idx
  ON provider_telemetry(report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_telemetry_run_idx
  ON provider_telemetry(run_id) WHERE run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION increment_report_usage(
  p_report_id UUID,
  p_cost NUMERIC,
  p_tokens INTEGER,
  p_calls INTEGER
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE reports
  SET actual_cost = actual_cost + p_cost,
      tokens_used = tokens_used + p_tokens,
      provider_calls_count = provider_calls_count + p_calls
  WHERE id = p_report_id;
$$;

CREATE OR REPLACE FUNCTION increment_run_usage(
  p_run_id UUID,
  p_cost NUMERIC,
  p_tokens INTEGER,
  p_calls INTEGER
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE visibility_runs
  SET actual_cost = actual_cost + p_cost,
      tokens_used = tokens_used + p_tokens,
      provider_calls_count = provider_calls_count + p_calls
  WHERE id = p_run_id;
$$;
