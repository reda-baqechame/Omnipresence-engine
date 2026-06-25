-- Phase 6: Keyword intelligence + content gap storage

CREATE TABLE IF NOT EXISTS keyword_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  volume_estimate INT,
  difficulty INT CHECK (difficulty IS NULL OR difficulty BETWEEN 0 AND 100),
  intent TEXT,
  our_position INT,
  opportunity_score INT NOT NULL DEFAULT 0 CHECK (opportunity_score BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'omnidata_serp',
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'tracking', 'targeted', 'ranking', 'dismissed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword)
);

CREATE TABLE IF NOT EXISTS content_gap_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  competitor_domain TEXT NOT NULL,
  competitor_position INT,
  our_position INT,
  opportunity_score INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'brief_queued', 'published', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, keyword, competitor_domain)
);

CREATE INDEX IF NOT EXISTS idx_keyword_opportunities_project ON keyword_opportunities(project_id, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_content_gap_project ON content_gap_findings(project_id, opportunity_score DESC);

ALTER TABLE keyword_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_gap_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY keyword_opportunities_org ON keyword_opportunities FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY content_gap_org ON content_gap_findings FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);
