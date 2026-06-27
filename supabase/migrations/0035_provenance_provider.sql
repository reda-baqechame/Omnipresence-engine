-- Trust Spine completion: every provenance-bearing table also records WHICH
-- provider produced the value and, on failure, WHY it is unavailable. This lets
-- the UI/report show "source: X, last checked: Y" and never present a failed
-- provider call as a confident measured value.

ALTER TABLE technical_findings
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE visibility_results
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE authority_opportunities
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE attribution_metrics
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;
