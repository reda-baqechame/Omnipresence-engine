-- Public audit lead capture (marketing funnel)
CREATE TABLE audit_leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  brand_name TEXT,
  industry TEXT,
  score_snapshot JSONB,
  source TEXT NOT NULL DEFAULT 'public_audit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_leads_email ON audit_leads(email);
CREATE INDEX idx_audit_leads_created_at ON audit_leads(created_at DESC);

ALTER TABLE audit_leads ENABLE ROW LEVEL SECURITY;
