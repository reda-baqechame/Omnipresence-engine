-- Phase 22: Onboarding, guarantee & continuous optimization loop.
-- operating_plans: onboarding output (business model + master competitor list +
--   keyword universe + 90-day plan) generated from the objective wizard.
-- operating_reviews: daily/weekly/monthly/quarterly cadence digests (gainers/
--   losers, decay, regressions, citation gaps) with tasks created.

CREATE TABLE IF NOT EXISTS operating_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_model JSONB NOT NULL DEFAULT '{}',
  competitor_universe JSONB NOT NULL DEFAULT '[]',
  keyword_universe JSONB NOT NULL DEFAULT '[]',
  plan JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_operating_plans_project ON operating_plans(project_id);

ALTER TABLE operating_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operating_plans_all ON operating_plans;
CREATE POLICY operating_plans_all ON operating_plans FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE TABLE IF NOT EXISTS operating_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cadence TEXT NOT NULL,
  digest JSONB NOT NULL DEFAULT '{}',
  tasks_created INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operating_reviews_project ON operating_reviews(project_id, created_at DESC);

ALTER TABLE operating_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operating_reviews_all ON operating_reviews;
CREATE POLICY operating_reviews_all ON operating_reviews FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
