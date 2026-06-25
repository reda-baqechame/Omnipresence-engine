import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { classifyReferrer } from "@/lib/tracking/ai-referrers";
import { enrichVisitorFromIp } from "@/lib/engines/visitor-identity";

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

export async function POST(request: NextRequest) {
  const { projectId, referrer, path, sessionId } = await request.json();

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const source = classifyReferrer(referrer);
  const ip = clientIp(request);

  try {
    const supabase = await createServiceClient();
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
