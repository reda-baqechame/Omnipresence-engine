-- Phase 1: Trust Spine — data provenance + confirmed competitor domains.
-- Every user-facing metric gets first-class provenance so the UI can label each
-- number Live / Estimated / Model-knowledge / Demo / Unavailable, and a failed
-- provider is never persisted as a confident zero.

-- Provenance columns (all idempotent) --------------------------------------
ALTER TABLE visibility_results
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE technical_findings
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE coverage_items
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS data_quality TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT;

ALTER TABLE authority_opportunities
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_url TEXT,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false;

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS measured_inputs INT,
  ADD COLUMN IF NOT EXISTS total_inputs INT;

ALTER TABLE keyword_opportunities
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS volume_range TEXT,
  ADD COLUMN IF NOT EXISTS volume_low INT,
  ADD COLUMN IF NOT EXISTS volume_high INT,
  ADD COLUMN IF NOT EXISTS volume_confidence TEXT,
  ADD COLUMN IF NOT EXISTS difficulty_method TEXT,
  ADD COLUMN IF NOT EXISTS trend_index INT;

ALTER TABLE attribution_metrics
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_estimated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_availability JSONB;

-- Confirmed competitor domains ---------------------------------------------
-- Replaces brand-name + ".com" guessing with SERP-resolved, confidence-scored,
-- human-confirmable competitor domains.
CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT,
  source TEXT,
  confidence NUMERIC,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  evidence_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_competitors_project ON competitors(project_id);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY competitors_org ON competitors FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);
