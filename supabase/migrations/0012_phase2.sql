-- Phase 2: Programmatic SEO, rank tracking, internal linking

CREATE TABLE IF NOT EXISTS pseo_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_type TEXT NOT NULL CHECK (template_type IN ('location_page', 'service_page', 'best_of_page', 'comparison_page')),
  url_pattern TEXT NOT NULL DEFAULT '/{slug}',
  services TEXT[] DEFAULT '{}',
  locations TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'completed', 'paused')),
  generated_count INT NOT NULL DEFAULT 0,
  max_pages INT NOT NULL DEFAULT 50,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rank_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'United States',
  target_url TEXT,
  is_striking_distance BOOLEAN DEFAULT false,
  last_position INT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword, location)
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id UUID NOT NULL REFERENCES rank_keywords(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position INT,
  ranking_url TEXT,
  serp_features TEXT[] DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_keyword ON rank_snapshots(keyword_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS internal_link_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor_suggestion TEXT NOT NULL,
  relevance_score INT NOT NULL DEFAULT 0 CHECK (relevance_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'approved', 'applied', 'rejected')),
  context_snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source_url, target_url)
);

ALTER TABLE pseo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_link_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY pseo_campaigns_org ON pseo_campaigns FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY rank_keywords_org ON rank_keywords FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY rank_snapshots_org ON rank_snapshots FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY internal_links_org ON internal_link_opportunities FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);
