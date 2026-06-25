-- Phase 8: indexing log, link building orders, community mentions

CREATE TABLE IF NOT EXISTS url_indexing_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('indexnow', 'bing', 'google')),
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS link_building_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_url TEXT NOT NULL,
  anchor_text TEXT NOT NULL,
  anchor_type TEXT NOT NULL CHECK (anchor_type IN ('branded', 'partial', 'exact')),
  vendor_tier TEXT NOT NULL DEFAULT 'growth',
  estimated_dr INT DEFAULT 35,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'live', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('reddit', 'quora', 'other')),
  url TEXT NOT NULL,
  keyword TEXT,
  mention_type TEXT DEFAULT 'brand',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE url_indexing_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_building_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY url_indexing_log_access ON url_indexing_log FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY link_building_orders_access ON link_building_orders FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);

CREATE POLICY community_mentions_access ON community_mentions FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);
