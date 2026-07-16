import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkPublicPageRateLimit } from "@/lib/security/public-guard";
import { loadPublicReceipt } from "@/lib/engines/receipt-verify";

export const dynamic = "force-dynamic";

/**
 * Machine-readable receipt verification (Phase 0, Master Plan v4). Same data
 * as /verify/{receipt_id}, as JSON, so agencies/auditors can verify receipts
 * programmatically. Public via unguessable UUID capability; rate limited.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ receiptId: string }> }
) {
  const { receiptId } = await params;

  const rateLimit = await checkPublicPageRateLimit(req.headers, "receipt-verify-api", 120, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rateLimit.retryAfterSec },
      { status: 429 }
    );
  }

  const supabase = await createServiceClient();
  const receipt = await loadPublicReceipt(supabase, receiptId);
  if (!receipt) {
    return NextResponse.json({ error: "receipt_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    receipt: {
      id: receipt.id,
      engine: receipt.engine,
      surface: receipt.surface,
      surface_type: receipt.surfaceType,
      measurement_mode: receipt.measurementMode,
      prompt: receipt.prompt,
      raw_answer: receipt.rawAnswer,
      cited_urls: receipt.citedUrls,
      source_domains: receipt.sourceDomains,
      response_hash: receipt.responseHash,
      prev_hash: receipt.prevHash,
      receipt_hash: receipt.receiptHash,
      chain_position: receipt.chainPosition,
      captured_at: receipt.capturedAt,
    },
    verification: {
      verdict: receipt.verification.verdict,
      chained: receipt.verification.chained,
      answer_hash_valid: receipt.verification.answerHashValid,
      receipt_hash_valid: receipt.verification.receiptHashValid,
      prev_link_found: receipt.verification.prevLinkFound,
      prev_link_valid: receipt.verification.prevLinkValid,
      recompute:
        'receipt_hash = sha256(prev_hash + ":" + response_hash + ":" + receipt_id + ":" + captured_at_utc_iso_microseconds)',
    },
  });
}
