-- Provider adapter telemetry for bounded weekly recalibration (Wave 4).
CREATE TABLE IF NOT EXISTS public.provider_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  capability TEXT NOT NULL,
  provider TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  error_message TEXT,
  trace_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_telemetry_provider_created_idx
  ON public.provider_telemetry (provider, created_at DESC);

CREATE INDEX IF NOT EXISTS provider_telemetry_org_created_idx
  ON public.provider_telemetry (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

ALTER TABLE public.provider_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_telemetry_org_read ON public.provider_telemetry
  FOR SELECT
  USING (
    organization_id IS NULL
    OR organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Inserts are service-role / server only (no client INSERT policy).
