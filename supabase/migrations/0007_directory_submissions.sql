-- Directory submission tracking on coverage items

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS submission_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE coverage_items DROP CONSTRAINT IF EXISTS coverage_items_submission_status_check;
ALTER TABLE coverage_items
  ADD CONSTRAINT coverage_items_submission_status_check
  CHECK (submission_status IN ('not_started', 'in_progress', 'submitted', 'live'));
