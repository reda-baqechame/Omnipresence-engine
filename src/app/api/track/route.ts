import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { classifyReferrer } from "@/lib/tracking/ai-referrers";
import { enrichVisitorFromIp } from "@/lib/engines/visitor-identity";
import { guardPublicEndpoint } from "@/lib/security/public-guard";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

export async function POST(request: NextRequest) {
  // Public beacon: rate-limit per IP to prevent anonymous row-flooding.
  const limited = guardPublicEndpoint(request, "track", 120, 60_000);
  if (limited) return limited;

  let payload: {
    projectId?: unknown;
    referrer?: unknown;
    path?: unknown;
    sessionId?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    // Malformed body from a public beacon → clean 400, not a noisy 500.
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { projectId, referrer, path, sessionId } = payload as {
    projectId?: string;
    referrer?: string;
    path?: string;
    sessionId?: string;
  };

  if (!projectId || typeof projectId !== "string" || !UUID_RE.test(projectId)) {
    return NextResponse.json({ error: "valid projectId required" }, { status: 400 });
  }

  const source = classifyReferrer(referrer);
  const ip = clientIp(request);

  try {
    const supabase = await createServiceClient();

    // Only record beacons for projects that actually exist — stops attackers
    // from seeding analytics tables with fabricated project IDs.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ tracked: false }, { status: 404 });
    }

    const enrichment = await enrichVisitorFromIp(ip);

    await supabase.from("visitor_sessions").insert({
      project_id: projectId,
      session_id: sessionId?.slice(0, 100),
      landing_path: path?.slice(0, 500),
      referrer_source: source || referrer?.slice(0, 200) || null,
      company_name: enrichment.companyName,
      company_domain: enrichment.companyDomain,
      industry: enrichment.industry,
      enriched: enrichment.enriched,
    });

    if (source) {
      await supabase.from("ai_referrals").insert({
        project_id: projectId,
        referrer_source: source,
        landing_path: path?.slice(0, 500),
        user_agent: request.headers.get("user-agent")?.slice(0, 300),
        session_id: sessionId?.slice(0, 100),
      });
      return NextResponse.json({ tracked: true, source, enriched: enrichment.enriched });
    }

    return NextResponse.json({ tracked: true, source: null, enriched: enrichment.enriched });
  } catch {
    return NextResponse.json({ tracked: false });
  }
}
