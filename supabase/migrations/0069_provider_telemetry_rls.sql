-- Close cross-tenant read on platform-wide telemetry rows (organization_id IS NULL).

DROP POLICY IF EXISTS provider_telemetry_org_read ON public.provider_telemetry;

CREATE POLICY provider_telemetry_org_read ON public.provider_telemetry
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Platform-wide rows (NULL organization_id) are visible only via service role (no client policy).
