-- Report quality gate violations (Patch F.1b).
-- Structured telemetry from validateReportClaims() — internal/observability only.
-- No customer-facing UI yet; service-role inserts from report generation paths.

CREATE TABLE IF NOT EXISTS report_quality_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NULL,
  project_id UUID NULL,
  org_id UUID NULL,
  report_type TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  section TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  field TEXT NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  source_label TEXT NULL,
  classification TEXT NULL,
  render_path TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_quality_violations_report_created_idx
  ON report_quality_violations (report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS report_quality_violations_project_created_idx
  ON report_quality_violations (project_id, created_at DESC);

-- Service-role-only reference/observability data (same posture as benchmark_runs).
ALTER TABLE report_quality_violations ENABLE ROW LEVEL SECURITY;
