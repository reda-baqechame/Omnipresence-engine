-- Organization notification settings + audit leads read access
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;

CREATE POLICY audit_leads_select_authenticated ON audit_leads
  FOR SELECT TO authenticated
  USING (true);
