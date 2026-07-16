/**
 * Public receipt verification (Phase 0, Master Plan v4).
 *
 * A receipt id is an unguessable UUID acting as a capability URL. Verification
 * is INDEPENDENT recomputation, not assertion: the answer hash is recomputed
 * from the stored answer and the chain link is recomputed from prev_hash +
 * response_hash + id + captured_at (via the verify_evidence_receipt Postgres
 * function, which owns the canonical serialization). A retention-pruned
 * predecessor is reported as "pruned", never conflated with tampering.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReceiptVerification {
  chained: boolean;
  answerHashValid: boolean;
  receiptHashValid: boolean;
  prevLinkFound: boolean;
  prevLinkValid: boolean;
  /** Overall verdict for display: verified | unchained | tampered */
  verdict: "verified" | "unchained" | "failed";
}

export interface PublicReceipt {
  id: string;
  engine: string;
  /** Exact probed surface (surface-identity taxonomy), when recorded. */
  surface: string | null;
  surfaceType: string;
  measurementMode: string | null;
  prompt: string;
  rawAnswer: string | null;
  citedUrls: string[];
  sourceDomains: string[];
  responseHash: string;
  prevHash: string | null;
  receiptHash: string | null;
  chainPosition: number | null;
  capturedAt: string;
  screenshotUrl: string | null;
  verification: ReceiptVerification;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function loadPublicReceipt(
  supabase: SupabaseClient,
  receiptId: string
): Promise<PublicReceipt | null> {
  if (!isUuid(receiptId)) return null;

  const { data: row } = await supabase
    .from("ai_capture_evidence")
    .select(
      "id, engine, surface, surface_type, measurement_mode, prompt, raw_answer, cited_urls, source_domains, response_hash, prev_hash, receipt_hash, chain_position, captured_at, screenshot_path"
    )
    .eq("id", receiptId)
    .maybeSingle();
  if (!row) return null;

  // Independent recomputation in Postgres (canonical serialization lives there).
  let v: {
    chained: boolean;
    answer_hash_valid: boolean;
    receipt_hash_valid: boolean;
    prev_link_found: boolean;
    prev_link_valid: boolean;
  } | null = null;
  try {
    const { data } = await supabase.rpc("verify_evidence_receipt", { p_id: receiptId });
    v = Array.isArray(data) ? data[0] ?? null : data ?? null;
  } catch {
    v = null;
  }

  const chained = Boolean(v?.chained ?? row.receipt_hash != null);
  const answerHashValid = Boolean(v?.answer_hash_valid);
  const receiptHashValid = Boolean(v?.receipt_hash_valid);
  const prevLinkFound = Boolean(v?.prev_link_found);
  const prevLinkValid = Boolean(v?.prev_link_valid);

  let verdict: ReceiptVerification["verdict"];
  if (!chained) {
    verdict = "unchained";
  } else if (answerHashValid && receiptHashValid && (prevLinkValid || !prevLinkFound)) {
    // A pruned predecessor (retention) doesn't fail the receipt itself: this
    // row's own hashes still verify. It's surfaced separately in the UI.
    verdict = "verified";
  } else {
    verdict = "failed";
  }

  // Short-lived signed URL for the screenshot artifact, if one exists.
  let screenshotUrl: string | null = null;
  if (row.screenshot_path) {
    try {
      const { data: signed } = await supabase.storage
        .from("ai-evidence")
        .createSignedUrl(row.screenshot_path, 3600);
      screenshotUrl = signed?.signedUrl ?? null;
    } catch {
      screenshotUrl = null;
    }
  }

  return {
    id: row.id,
    engine: row.engine,
    surface: row.surface ?? null,
    surfaceType: row.surface_type,
    measurementMode: row.measurement_mode ?? null,
    prompt: row.prompt,
    rawAnswer: row.raw_answer ?? null,
    citedUrls: row.cited_urls ?? [],
    sourceDomains: row.source_domains ?? [],
    responseHash: row.response_hash,
    prevHash: row.prev_hash ?? null,
    receiptHash: row.receipt_hash ?? null,
    chainPosition: row.chain_position ?? null,
    capturedAt: row.captured_at,
    screenshotUrl,
    verification: {
      chained,
      answerHashValid,
      receiptHashValid,
      prevLinkFound,
      prevLinkValid,
      verdict,
    },
  };
}
