-- Phase 0 (Master Plan v4) — verifiable receipt hash chain.
--
-- Upgrades ai_capture_evidence rows from standalone tamper-evident fingerprints
-- into a per-project hash CHAIN: every receipt records the receipt_hash of the
-- previous receipt (prev_hash) and its own receipt_hash, computed in Postgres
-- under a per-project advisory lock so concurrent scans can never fork the
-- chain. A public /verify/{receipt_id} page recomputes both the answer hash and
-- the chain link via verify_evidence_receipt() — proof, not assertion.
--
-- Chaining is best-effort and append-only: rows inserted before this migration
-- (or when the RPC is unavailable) simply have NULL receipt_hash and read as
-- "unchained" — never silently backfilled, because backfilling would fabricate
-- a capture order we did not record at capture time.

ALTER TABLE ai_capture_evidence ADD COLUMN IF NOT EXISTS surface TEXT;
ALTER TABLE ai_capture_evidence ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE ai_capture_evidence ADD COLUMN IF NOT EXISTS receipt_hash TEXT;
ALTER TABLE ai_capture_evidence ADD COLUMN IF NOT EXISTS chain_position BIGINT;

CREATE INDEX IF NOT EXISTS idx_ai_capture_evidence_chain
  ON ai_capture_evidence(project_id, chain_position DESC)
  WHERE chain_position IS NOT NULL;

-- pgcrypto (digest) is enabled in 0001_init; re-assert for standalone installs.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Append one evidence row to its project's receipt chain. Serialized per
-- project via advisory xact lock. Idempotent: a row already chained is left
-- untouched (returns its existing link).
CREATE OR REPLACE FUNCTION chain_evidence_receipt(p_id UUID)
RETURNS TABLE (out_prev_hash TEXT, out_receipt_hash TEXT, out_chain_position BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project UUID;
  v_response_hash TEXT;
  v_captured TIMESTAMPTZ;
  v_existing_receipt TEXT;
  v_existing_prev TEXT;
  v_existing_pos BIGINT;
  v_prev TEXT;
  v_pos BIGINT;
  v_receipt TEXT;
BEGIN
  SELECT project_id, response_hash, captured_at, receipt_hash, prev_hash, chain_position
    INTO v_project, v_response_hash, v_captured, v_existing_receipt, v_existing_prev, v_existing_pos
    FROM ai_capture_evidence WHERE id = p_id;
  IF v_project IS NULL THEN
    RETURN;
  END IF;
  IF v_existing_receipt IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_prev, v_existing_receipt, v_existing_pos;
    RETURN;
  END IF;

  -- One appender per project at a time — the chain can never fork.
  PERFORM pg_advisory_xact_lock(hashtext(v_project::text));

  SELECT e.receipt_hash, e.chain_position INTO v_prev, v_pos
    FROM ai_capture_evidence e
    WHERE e.project_id = v_project AND e.receipt_hash IS NOT NULL
    ORDER BY e.chain_position DESC
    LIMIT 1;

  v_prev := COALESCE(v_prev, 'genesis');
  v_pos  := COALESCE(v_pos, 0) + 1;
  v_receipt := encode(
    digest(
      v_prev || ':' || v_response_hash || ':' || p_id::text || ':' ||
      to_char(v_captured AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sha256'
    ),
    'hex'
  );

  UPDATE ai_capture_evidence
     SET prev_hash = v_prev, receipt_hash = v_receipt, chain_position = v_pos
   WHERE id = p_id;

  RETURN QUERY SELECT v_prev, v_receipt, v_pos;
END;
$$;

-- Independent verification: recomputes the answer hash and the chain link from
-- stored data (same canonical serialization as chain_evidence_receipt) so the
-- public verify page proves rather than asserts. Field meanings:
--   answer_hash_valid : sha256(raw_answer) == response_hash
--   receipt_hash_valid: recomputed chain hash == receipt_hash
--   prev_link_found   : the chain_position-1 row still exists (retention may
--                       have pruned it — reported, not conflated with tamper)
--   prev_link_valid   : prev row's receipt_hash == this row's prev_hash
CREATE OR REPLACE FUNCTION verify_evidence_receipt(p_id UUID)
RETURNS TABLE (
  chained BOOLEAN,
  answer_hash_valid BOOLEAN,
  receipt_hash_valid BOOLEAN,
  prev_link_found BOOLEAN,
  prev_link_valid BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_prev_receipt TEXT;
  v_recomputed TEXT;
BEGIN
  SELECT * INTO r FROM ai_capture_evidence WHERE id = p_id;
  IF r.id IS NULL THEN
    RETURN;
  END IF;

  chained := r.receipt_hash IS NOT NULL;
  answer_hash_valid := encode(digest(COALESCE(r.raw_answer, ''), 'sha256'), 'hex') = r.response_hash;

  IF NOT chained THEN
    receipt_hash_valid := FALSE;
    prev_link_found := FALSE;
    prev_link_valid := FALSE;
    RETURN QUERY SELECT chained, answer_hash_valid, receipt_hash_valid, prev_link_found, prev_link_valid;
    RETURN;
  END IF;

  v_recomputed := encode(
    digest(
      r.prev_hash || ':' || r.response_hash || ':' || r.id::text || ':' ||
      to_char(r.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'sha256'
    ),
    'hex'
  );
  receipt_hash_valid := v_recomputed = r.receipt_hash;

  IF r.chain_position = 1 THEN
    prev_link_found := TRUE;
    prev_link_valid := r.prev_hash = 'genesis';
  ELSE
    SELECT e.receipt_hash INTO v_prev_receipt
      FROM ai_capture_evidence e
      WHERE e.project_id = r.project_id AND e.chain_position = r.chain_position - 1;
    prev_link_found := v_prev_receipt IS NOT NULL;
    prev_link_valid := v_prev_receipt IS NOT NULL AND v_prev_receipt = r.prev_hash;
  END IF;

  RETURN QUERY SELECT chained, answer_hash_valid, receipt_hash_valid, prev_link_found, prev_link_valid;
END;
$$;
