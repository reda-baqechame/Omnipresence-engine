-- Phase 1 (presence-os-110) — first-class measurement evidence.
-- Generalizes the AI-capture evidence spine (ai_capture_evidence) to EVERY
-- measured capability (SERP, rank, backlink graph, pagespeed, tech, ...), so any
-- user-facing number can be traced to a reproducible, tamper-evident record:
-- the source URL, the provider that produced it, the parser version, a sha256 of
-- the raw payload, the provenance/confidence, and (best-effort) the full raw
-- payload in the private ai-evidence storage bucket.

CREATE TABLE IF NOT EXISTS measurement_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- serp | rank | backlink_graph | pagespeed | tech | keyword | local | ...
  capability TEXT NOT NULL,
  -- what was measured: a keyword, URL, or domain
  target TEXT NOT NULL,
  -- which sovereign/provider produced the value (serper, omnidata, pagespeed, gsc, ...)
  provider TEXT,
  -- canonical source location (SERP url, audited page url) for reproducibility
  source_url TEXT,
  -- engine/parser version so a re-run is comparable
  parser_version TEXT,
  -- provenance: measured | estimated | model_knowledge | simulated | unavailable
  data_source TEXT NOT NULL DEFAULT 'measured',
  -- 0..1 confidence in the value
  confidence NUMERIC,
  -- sha256 of the raw payload (tamper-evident fingerprint)
  response_hash TEXT NOT NULL,
  -- small bounded structured excerpt of the result (never the full payload)
  payload_excerpt JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- storage path of the full raw artifact (signed-URL-able), or null
  evidence_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurement_evidence_project
  ON measurement_evidence(project_id, capability, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_measurement_evidence_hash
  ON measurement_evidence(response_hash);

ALTER TABLE measurement_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS measurement_evidence_org ON measurement_evidence;
CREATE POLICY measurement_evidence_org ON measurement_evidence FOR ALL USING (
  project_id IN (
    SELECT p.id FROM projects p
    JOIN memberships m ON m.organization_id = p.organization_id
    WHERE m.user_id = auth.uid()
  )
);
