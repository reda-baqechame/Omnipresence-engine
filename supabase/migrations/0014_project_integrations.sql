-- Project integrations (CMS, social, GBP credentials — encrypted at app layer)

CREATE TABLE IF NOT EXISTS project_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('wordpress', 'webflow', 'shopify', 'buffer', 'ayrshare', 'gbp')),
  credentials_encrypted TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_project_integrations_project ON project_integrations(project_id);

ALTER TABLE project_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_integrations_org ON project_integrations FOR ALL USING (
  project_id IN (SELECT p.id FROM projects p JOIN memberships m ON m.organization_id = p.organization_id WHERE m.user_id = auth.uid())
);
