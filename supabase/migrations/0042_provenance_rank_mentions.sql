-- Provenance hardening: rank_snapshots and brand_mentions are real measurements
-- but were written without the standard provenance fields the rest of the
-- platform uses. Add them (additive, idempotent) so every metric row carries
-- data_source / confidence / last_checked_at and refund-safety holds end-to-end.

ALTER TABLE rank_snapshots
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE brand_mentions
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;
