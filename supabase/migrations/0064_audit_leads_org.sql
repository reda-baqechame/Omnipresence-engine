-- Scope audit leads per organization (agency funnel isolation)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS audit_referral_token TEXT UNIQUE
    DEFAULT encode(gen_random_bytes(16), 'hex');

UPDATE organizations
SET audit_referral_token = encode(gen_random_bytes(16), 'hex')
WHERE audit_referral_token IS NULL;

ALTER TABLE organizations
  ALTER COLUMN audit_referral_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_audit_referral_token
  ON organizations(audit_referral_token);

ALTER TABLE audit_leads
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_leads_org ON audit_leads(organization_id, created_at DESC);

DROP POLICY IF EXISTS audit_leads_select_admin ON audit_leads;

-- Only org owners/admins see leads attributed to their organization
CREATE POLICY audit_leads_select_org_admin ON audit_leads
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id IN (
      SELECT organization_id FROM memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
