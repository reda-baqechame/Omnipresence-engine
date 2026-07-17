-- Claim review (Master Plan v4 feature 7): flag wrong statements AI engines
-- make about the brand, each tied to the receipt of the answer it came from.
-- Athena gates this at enterprise; we include it on every plan.

CREATE TABLE IF NOT EXISTS claim_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'no_answers', 'failed')),
  -- Array of reviewed claims:
  -- { claim, engine, surface, verdict, explanation, quote, receipt_id, prompt }
  claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers_reviewed INT NOT NULL DEFAULT 0,
  flagged_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claim_reviews_project
  ON claim_reviews (project_id, created_at DESC);

ALTER TABLE claim_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claim_reviews_org ON claim_reviews;
CREATE POLICY claim_reviews_org ON claim_reviews FOR ALL
  USING (organization_id IN (SELECT get_user_org_ids()));
