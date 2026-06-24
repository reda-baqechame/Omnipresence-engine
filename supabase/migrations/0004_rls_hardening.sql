-- Harden RLS: restrict audit leads to org admins/owners

DROP POLICY IF EXISTS audit_leads_select_authenticated ON audit_leads;

CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY audit_leads_select_admin ON audit_leads
  FOR SELECT TO authenticated
  USING (is_org_admin());

-- OAuth connections: restrict writes to admin/owner
DROP POLICY IF EXISTS oauth_connections_all ON oauth_connections;

CREATE POLICY oauth_connections_select ON oauth_connections FOR SELECT
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

CREATE POLICY oauth_connections_insert ON oauth_connections FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member')
    )
  );

CREATE POLICY oauth_connections_update ON oauth_connections FOR UPDATE
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );

CREATE POLICY oauth_connections_delete ON oauth_connections FOR DELETE
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );
