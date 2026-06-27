-- Phase 3: Agency layer — white-label client portal + custom domain.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS white_label_domain TEXT,
  ADD COLUMN IF NOT EXISTS client_portal_enabled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_organizations_wl_domain ON organizations(white_label_domain);
