-- Phase 14: Brand & reputation monitoring.

CREATE TABLE IF NOT EXISTS brand_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'web',
  url TEXT NOT NULL,
  title TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'unknown')),
  sentiment_score NUMERIC,
  is_unlinked BOOLEAN NOT NULL DEFAULT false,
  mention_type TEXT NOT NULL DEFAULT 'brand',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE INDEX IF NOT EXISTS idx_brand_mentions_project ON brand_mentions(project_id, captured_at DESC);

ALTER TABLE brand_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brand_mentions_all ON brand_mentions;
CREATE POLICY brand_mentions_all ON brand_mentions FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
