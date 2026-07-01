import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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

  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const domain = typeof body.domain === "string" ? body.domain : null;
  if (!projectId || !domain) {
    return NextResponse.json({ error: "projectId and domain required" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const end = typeof body.periodEnd === "string" ? body.periodEnd : new Date().toISOString().slice(0, 10);
  const start =
    typeof body.periodStart === "string"
      ? body.periodStart
      : new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const { error } = await supabase.from("traffic_panel_observations").insert({
    project_id: projectId,
    organization_id: project.organization_id,
    domain,
    period_start: start,
    period_end: end,
    visits: typeof body.visits === "number" ? body.visits : null,
    unique_visitors: typeof body.uniqueVisitors === "number" ? body.uniqueVisitors : null,
    pageviews: typeof body.pageviews === "number" ? body.pageviews : null,
    source: typeof body.source === "string" ? body.source : "pixel",
    provenance: "panel_observed",
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
