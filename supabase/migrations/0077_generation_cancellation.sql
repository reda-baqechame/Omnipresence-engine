-- Generation cancellation: reports and visibility scans currently have no way
-- to be stopped once started. Add cancelling/cancelled states plus timestamps
-- so a user-initiated stop can be recorded, checked cooperatively inside the
-- long-running loops, and reflected honestly in report/scan status.

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE reports
  ADD CONSTRAINT reports_status_check
    CHECK (status IN ('pending', 'generating', 'ready', 'failed', 'cancelling', 'cancelled'));

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- visibility_runs.status is the scan_status ENUM (0001_init.sql), not a CHECK
-- constraint — new enum values must be added outside the same transaction
-- that uses them (fine here; this migration only adds the values).
ALTER TYPE scan_status ADD VALUE IF NOT EXISTS 'cancelling';
ALTER TYPE scan_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE visibility_runs
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reports_cancel_requested
  ON reports(id) WHERE cancel_requested_at IS NOT NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_visibility_runs_cancel_requested
  ON visibility_runs(id) WHERE cancel_requested_at IS NOT NULL AND cancelled_at IS NULL;
