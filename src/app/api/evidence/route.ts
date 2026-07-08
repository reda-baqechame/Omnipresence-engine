import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";

/**
 * GET /api/evidence?projectId=&capability=&target=
 * Returns measurement_evidence + ai_capture_evidence rows for a capability/target.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const capability = req.nextUrl.searchParams.get("capability");
  const target = req.nextUrl.searchParams.get("target");
  const limit = Math.min(50, Number(req.nextUrl.searchParams.get("limit") || 10));

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

  let measQ = supabase
    .from("measurement_evidence")
    .select(
      "id, capability, target, provider, source_url, parser_version, data_source, confidence, response_hash, payload_excerpt, evidence_url, trace_id, captured_at, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (capability) measQ = measQ.eq("capability", capability);
  if (target) measQ = measQ.ilike("target", `%${target}%`);

  let aiQ = supabase
    .from("ai_capture_evidence")
    .select(
      "id, engine, prompt, raw_answer, response_hash, cited_urls, source_domains, evidence_url, trace_id, captured_at, created_at"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (capability === "ai" || capability === "visibility") {
    // ai rows only
  } else if (capability && capability !== "ai_capture") {
    aiQ = aiQ.limit(0);
  }

  const [{ data: measurement }, { data: aiCapture }] = await Promise.all([measQ, aiQ]);

  return NextResponse.json({
    measurement: measurement || [],
    aiCapture: aiCapture || [],
  });
}
