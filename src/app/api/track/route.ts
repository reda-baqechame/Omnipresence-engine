import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { classifyReferrer } from "@/lib/tracking/ai-referrers";

export async function POST(request: NextRequest) {
  const { projectId, referrer, path, sessionId } = await request.json();

  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const source = classifyReferrer(referrer);
  if (!source) {
    return NextResponse.json({ tracked: false });
  }

  try {
    const supabase = await createServiceClient();
    await supabase.from("ai_referrals").insert({
      project_id: projectId,
      referrer_source: source,
      landing_path: path?.slice(0, 500),
      user_agent: request.headers.get("user-agent")?.slice(0, 300),
      session_id: sessionId?.slice(0, 100),
    });
    return NextResponse.json({ tracked: true, source });
  } catch {
    return NextResponse.json({ tracked: false });
  }
}
