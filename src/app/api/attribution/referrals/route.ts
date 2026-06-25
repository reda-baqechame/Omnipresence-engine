import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("ai_referrals")
    .select("referrer_source")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(5000);

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const src = row.referrer_source || "unknown";
    counts[src] = (counts[src] || 0) + 1;
  }

  const referrals = Object.entries(counts)
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ referrals, total: data?.length || 0 });
}
