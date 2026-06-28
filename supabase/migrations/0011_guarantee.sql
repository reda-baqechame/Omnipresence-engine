-- Guarantee spine: contracts, baseline lock, claims workflow

CREATE TABLE IF NOT EXISTS guarantee_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  kpi_metric TEXT NOT NULL CHECK (kpi_metric IN ('omnipresence_score', 'citation_rate', 'ai_referral_traffic', 'visibility_mention_rate')),
  threshold_value NUMERIC NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 90,
  plan_tier TEXT NOT NULL DEFAULT 'tracking',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'verified', 'failed', 'claimed', 'closed')),
  baseline_locked_at TIMESTAMPTZ,
  baseline_snapshot JSONB DEFAULT '{}',
  verified_at TIMESTAMPTZ,
  delta_summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guarantee_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES guarantee_contracts(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'under_review', 'approved', 'denied', 'credited')),
  evidence JSONB DEFAULT '[]',
  remedy_type TEXT NOT NULL DEFAULT 'service_credit' CHECK (remedy_type IN ('service_credit', 'work_free')),
  stripe_credit_id TEXT,
  credit_amount_cents INTEGER,
  reviewer_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guarantee_contracts_project ON guarantee_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_claims_contract ON guarantee_claims(contract_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_claims_project ON guarantee_claims(project_id);

ALTER TABLE guarantee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE guarantee_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guarantee_contracts_org_access ON guarantee_contracts;
CREATE POLICY guarantee_contracts_org_access ON guarantee_contracts
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS guarantee_claims_org_access ON guarantee_claims;
CREATE POLICY guarantee_claims_org_access ON guarantee_claims
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN memberships m ON m.organization_id = p.organization_id
      WHERE m.user_id = auth.uid()
    )
  );
