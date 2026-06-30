-- Wave N4 — Evidence artifact spine.
-- One auditable evidence record per measured AI/search probe: the raw answer, a
-- sha256 response_hash (tamper-evident), the REAL cited URLs/source domains, and
-- pointers to heavy artifacts (screenshot/DOM) stored in the private `ai-evidence`
-- bucket. This is what turns "trust me" into proof. visibility_results.evidence_url
-- points back here. Retention is capped per project by the app (cost control).

CREATE TABLE IF NOT EXISTS ai_capture_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id UUID,
  prompt_id UUID,
  engine TEXT NOT NULL,
  -- api | ui | search_result | model_knowledge
  surface_type TEXT NOT NULL DEFAULT 'api',
  prompt TEXT NOT NULL,
  measurement_mode TEXT,
  response_hash TEXT NOT NULL,
  raw_answer TEXT,
  cited_urls TEXT[] NOT NULL DEFAULT '{}',
  source_domains TEXT[] NOT NULL DEFAULT '{}',
  screenshot_path TEXT,
  dom_path TEXT,
  evidence_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_project ON ai_capture_evidence(project_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_run ON ai_capture_evidence(run_id);
CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_hash ON ai_capture_evidence(response_hash);

ALTER TABLE ai_capture_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_capture_evidence_all ON ai_capture_evidence;
CREATE POLICY ai_capture_evidence_all ON ai_capture_evidence FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE organization_id IN (SELECT get_user_org_ids())));

-- Private evidence bucket. Heavy artifacts (full answer JSON, screenshot PNG,
-- DOM HTML) are written by the service role and served via signed URLs — NOT
-- public, since they hold tenant measurement data.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-evidence',
  'ai-evidence',
  false,
  26214400,
  ARRAY['application/json', 'text/html', 'text/plain', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;
