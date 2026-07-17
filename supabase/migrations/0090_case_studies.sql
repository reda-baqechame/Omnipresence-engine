-- Master Plan v4 Phase 3 — named case studies with receipts.
-- A case study is generated ONLY from a project's own measured data (sprint
-- baselines/outcomes + receipt chain) and is publishable ONLY with explicit
-- named consent. Fabricated case studies were deleted in Phase 0 and the
-- output-quality gate keeps them deleted; this table is the honest replacement.

CREATE TABLE IF NOT EXISTS case_studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  -- Named consent: both names are shown publicly, so both must be real and
  -- explicitly approved by the org before publishing.
  brand_name TEXT NOT NULL,
  agency_name TEXT,
  consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  -- Measured before/after (from action_sprints baseline/outcome snapshots).
  baseline JSONB,
  outcome JSONB,
  outcome_verdict TEXT,
  -- Public receipt ids backing the numbers (ai_capture_evidence uuids).
  receipt_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_case_studies_published
  ON case_studies (published, published_at DESC);

ALTER TABLE case_studies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS case_studies_org ON case_studies;
CREATE POLICY case_studies_org ON case_studies FOR ALL
  USING (organization_id IN (SELECT get_user_org_ids()));
-- Published case studies are readable by anyone (public marketing pages read
-- via anon; unpublished drafts stay org-only).
DROP POLICY IF EXISTS case_studies_public_read ON case_studies;
CREATE POLICY case_studies_public_read ON case_studies FOR SELECT
  USING (published = TRUE AND consent_confirmed = TRUE);
