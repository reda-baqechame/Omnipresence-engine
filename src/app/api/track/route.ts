import { NextRequest, NextResponse } from "next/server";
import { TrackBeaconSchema } from "@/lib/validation/schemas";
import { createServiceClient } from "@/lib/supabase/server";
import { classifyReferrer } from "@/lib/tracking/ai-referrers";
import { enrichVisitorFromIp } from "@/lib/engines/visitor-identity";
import { guardPublicEndpoint } from "@/lib/security/public-guard";
import { verifyTrackingBeacon } from "@/lib/security/tracking-beacon";

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

export async function POST(request: NextRequest) {
  // Public beacon: rate-limit per IP to prevent anonymous row-flooding.
  const limited = await guardPublicEndpoint(request, "track", 120, 60_000);
  if (limited) return limited;

  const rawBody = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const v = TrackBeaconSchema.safeParse(parsed);
  if (!v.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { projectId, referrer, path, sessionId } = v.data;

  const source = classifyReferrer(referrer);
  const ip = clientIp(request);

  try {
    const supabase = await createServiceClient();

    const { data: project } = await supabase
      .from("projects")
      .select("id, tracking_hmac")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) {
      return NextResponse.json({ tracked: false }, { status: 404 });
    }

    const signature = request.headers.get("x-tracking-signature");
    if (project.tracking_hmac) {
      if (!verifyTrackingBeacon(rawBody, project.tracking_hmac, signature)) {
        return NextResponse.json({ error: "Invalid tracking signature" }, { status: 401 });
      }
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
