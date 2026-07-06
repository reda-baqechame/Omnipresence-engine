import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/** 1x1 beacon — records a panel observation (best-effort, secret optional for public pixel). */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const domain = req.nextUrl.searchParams.get("domain");
  if (!projectId || !domain) {
    return new NextResponse(null, { status: 204 });
  }

  const secret = process.env.TRAFFIC_PANEL_INGEST_SECRET;
  if (secret) {
    const header = req.headers.get("x-traffic-panel-secret");
    if (header !== secret) {
      return transparentGif();
    }
  }

  try {
    const supabase = await createServiceClient();
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id, domain")
      .eq("id", projectId)
      .single();
    if (!project || project.domain.replace(/^www\./, "") !== domain.replace(/^www\./, "")) {
      return transparentGif();
    }
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("traffic_panel_observations").insert({
      project_id: projectId,
      organization_id: project.organization_id,
      domain,
      period_start: today,
      period_end: today,
      visits: 1,
      source: "pixel",
      provenance: "panel_observed",
    });
  } catch {
    // best-effort
  }

  return transparentGif();
}

function transparentGif() {
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  return new NextResponse(gif, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" },
  });
}
