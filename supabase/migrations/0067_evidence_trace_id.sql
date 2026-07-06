-- Propagate request trace_id into evidence rows for end-to-end observability.
ALTER TABLE public.measurement_evidence
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

ALTER TABLE public.ai_capture_evidence
  ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE INDEX IF NOT EXISTS measurement_evidence_trace_idx
  ON public.measurement_evidence (trace_id)
  WHERE trace_id IS NOT NULL;
