-- Index parity for trace_id on ai_capture_evidence (0067 added column + index on measurement_evidence only).

CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_trace_id
  ON public.ai_capture_evidence (trace_id)
  WHERE trace_id IS NOT NULL;
