import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";

/**
 * GET /api/evidence/export?projectId=&since=&until=
 *
 * Export-before-deletion (Phase 0 retention policy, Master Plan v4): a full
 * JSON download of a project's receipt chain — every ai_capture_evidence row
 * with its hashes and chain links — so a tenant can archive receipts before
 * the plan retention window prunes them. Chain verification of an exported
 * bundle is possible offline: receipt_hash = sha256(prev_hash + ":" +
 * response_hash + ":" + id + ":" + captured_at_utc_iso_microseconds).
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await verifyProjectAccess(supabase, projectId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const receipts: unknown[] = [];
  const PAGE = 1000;
  const MAX_ROWS = 20000;
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = supabase
      .from("ai_capture_evidence")
      .select(
        "id, run_id, prompt_id, engine, surface, surface_type, prompt, measurement_mode, response_hash, raw_answer, cited_urls, source_domains, prev_hash, receipt_hash, chain_position, evidence_url, trace_id, captured_at, created_at"
      )
      .eq("project_id", projectId)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gte("captured_at", since);
    if (until) q = q.lte("captured_at", until);
    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: "export_failed" }, { status: 500 });
    }
    receipts.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }

  const body = JSON.stringify(
    {
      format: "presenceos-receipt-export.v1",
      project_id: projectId,
      exported_at: new Date().toISOString(),
      receipt_count: receipts.length,
      chain_recompute:
        'receipt_hash = sha256(prev_hash + ":" + response_hash + ":" + id + ":" + captured_at_utc_iso_microseconds)',
      receipts,
    },
    null,
    2
  );

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="receipts-${projectId}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
