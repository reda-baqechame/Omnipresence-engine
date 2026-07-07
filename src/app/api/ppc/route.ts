import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { PpcPostSchema } from "@/lib/validation/schemas";
import { captureCompetitorAds, estimatePpcSavings } from "@/lib/engines/ppc-intelligence";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  return NextResponse.json({
    available: true,
    message: "POST with action=competitor_ads or action=savings to fetch PPC intelligence",
    projectId,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, PpcPostSchema);
  if (v.response) return v.response;
  const {
    projectId,
    action,
    keywords: bodyKeywords,
    location,
    device,
    organicSessions,
    aiReferralSessions,
    monthlyAdSpend,
  } = v.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("industry")
    .eq("id", projectId)
    .single();

  if (action === "competitor_ads") {
    // Default to the project's tracked keywords if none supplied.
    let keywords = bodyKeywords || [];
    if (keywords.length === 0) {
      const { data: kws } = await supabase
        .from("keyword_opportunities")
        .select("keyword")
        .eq("project_id", projectId)
        .limit(15);
      keywords = (kws || []).map((k) => k.keyword as string);
    }
    const snapshot = await captureCompetitorAds(keywords, location || "United States", device || "desktop");
    return NextResponse.json(snapshot);
  }

  if (action === "savings") {
    const savings = await estimatePpcSavings({
      organicSessions: organicSessions || 0,
      aiReferralSessions: aiReferralSessions || 0,
      monthlyAdSpend,
      industry: (project?.industry as string) || undefined,
      keywords: bodyKeywords,
    });
    return NextResponse.json(savings);
  }

  return apiError("Unknown action");
}
