-- Require organization_id for agency-sourced audit leads (public funnel may stay NULL).

CREATE OR REPLACE FUNCTION public.reject_audit_lead_null_org()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.source LIKE 'agency%' THEN
    RAISE EXCEPTION 'audit_leads.organization_id is required for agency-sourced leads';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_leads_require_org ON public.audit_leads;
CREATE TRIGGER audit_leads_require_org
  BEFORE INSERT OR UPDATE ON public.audit_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_audit_lead_null_org();
