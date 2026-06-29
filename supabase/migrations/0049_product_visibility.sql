-- Merchant / Product AI visibility (Phase 23 / manifest v24, Wave B).
--
-- Tracks whether the brand's products surface in (a) Google Shopping/organic SERP
-- and (b) AI product recommendations ("best <category>", "what should I buy…").
-- Complements merchant_products (feed QA) with actual measured product visibility
-- over time. SERP presence is `measured`; parametric AI recommendations are
-- labeled `model_knowledge` (honest — not a grounded UI capture).

CREATE TABLE IF NOT EXISTS product_visibility_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id TEXT,
  query TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'shopping_serp',
  engine TEXT NOT NULL,
  brand_present BOOLEAN NOT NULL DEFAULT false,
  position INT,
  competitors_present JSONB NOT NULL DEFAULT '[]'::jsonb,
  cited_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_source TEXT NOT NULL DEFAULT 'measured',
  confidence NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_visibility_project ON product_visibility_snapshots(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_visibility_surface ON product_visibility_snapshots(project_id, surface);

ALTER TABLE product_visibility_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_visibility_snapshots_all ON product_visibility_snapshots;
CREATE POLICY product_visibility_snapshots_all ON product_visibility_snapshots FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
