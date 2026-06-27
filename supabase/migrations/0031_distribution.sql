-- Phase 18: Distribution & publishing lifecycle tracking.

CREATE TABLE IF NOT EXISTS distribution_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES content_assets(id) ON DELETE SET NULL,
  destination TEXT NOT NULL, -- wordpress | webflow | shopify | ghost | linkedin | x | reddit | quora | youtube | newsletter | gbp | directory
  stage TEXT NOT NULL DEFAULT 'drafted'
    CHECK (stage IN ('drafted','approved','scheduled','published','indexed','ranking','cited','getting_leads','needs_refresh','failed')),
  scheduled_at TIMESTAMPTZ,
  published_url TEXT,
  external_id TEXT,
  stage_history JSONB NOT NULL DEFAULT '[]',
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distribution_jobs_project ON distribution_jobs(project_id, stage);
CREATE INDEX IF NOT EXISTS idx_distribution_jobs_asset ON distribution_jobs(asset_id);

ALTER TABLE distribution_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS distribution_jobs_all ON distribution_jobs;
CREATE POLICY distribution_jobs_all ON distribution_jobs FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP TRIGGER IF EXISTS trg_distribution_jobs_updated ON distribution_jobs;
CREATE TRIGGER trg_distribution_jobs_updated
  BEFORE UPDATE ON distribution_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
