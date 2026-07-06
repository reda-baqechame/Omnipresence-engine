import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { validateBody } from "@/lib/security/api-response";
import { TrafficPanelIngestSchema } from "@/lib/validation/schemas";

/**
 * POST /api/traffic-panel/ingest
 * Opt-in traffic panel pixel / WordPress plugin ingestion.
 * Body: { projectId, domain, visits?, uniqueVisitors?, pageviews?, source?, periodStart?, periodEnd? }
 * Auth: TRAFFIC_PANEL_INGEST_SECRET header must match env.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-traffic-panel-secret");
  const expected = process.env.TRAFFIC_PANEL_INGEST_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await validateBody(req, TrafficPanelIngestSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const { projectId, domain, visits } = body;

  const supabase = await createServiceClient();
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const { error } = await supabase.from("traffic_panel_observations").insert({
    project_id: projectId,
    organization_id: project.organization_id,
    domain,
    period_start: start,
    period_end: end,
    visits: visits ?? null,
    unique_visitors: null,
    pageviews: null,
    source: "pixel",
    provenance: "panel_observed",
    metadata: {},
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
