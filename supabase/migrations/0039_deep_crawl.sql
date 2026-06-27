-- Phase 4 (100X): deep technical crawl (Screaming-Frog-class) storage.

CREATE TABLE IF NOT EXISTS crawl_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status INT NOT NULL DEFAULT 0,
  depth INT NOT NULL DEFAULT 0,
  title TEXT,
  meta_description TEXT,
  h1_count INT NOT NULL DEFAULT 0,
  canonical TEXT,
  noindex BOOLEAN NOT NULL DEFAULT false,
  word_count INT NOT NULL DEFAULT 0,
  internal_links INT NOT NULL DEFAULT 0,
  external_links INT NOT NULL DEFAULT 0,
  redirect_hops INT NOT NULL DEFAULT 0,
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawl_pages_project ON crawl_pages(project_id, status);

CREATE TABLE IF NOT EXISTS crawl_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  detail TEXT,
  urls JSONB NOT NULL DEFAULT '[]',
  data_source TEXT NOT NULL DEFAULT 'measured',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crawl_issues_project ON crawl_issues(project_id, severity);

ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crawl_pages_all ON crawl_pages;
CREATE POLICY crawl_pages_all ON crawl_pages FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

DROP POLICY IF EXISTS crawl_issues_all ON crawl_issues;
CREATE POLICY crawl_issues_all ON crawl_issues FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
