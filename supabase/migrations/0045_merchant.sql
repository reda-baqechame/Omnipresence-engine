-- Merchant / Shopping vertical: store the parsed + audited product feed so the
-- UI can show feed-quality scores, top issues, and LLM-optimized titles/
-- descriptions, and so feed issues can be tracked as execution_tasks.

CREATE TABLE IF NOT EXISTS merchant_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  optimized_title TEXT,
  optimized_description TEXT,
  brand TEXT,
  price TEXT,
  issues JSONB NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  json_ld JSONB,
  data_source TEXT NOT NULL DEFAULT 'measured',
  audited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_merchant_products_project ON merchant_products(project_id, score);

ALTER TABLE merchant_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_products_all ON merchant_products;
CREATE POLICY merchant_products_all ON merchant_products FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));
