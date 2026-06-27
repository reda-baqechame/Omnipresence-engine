import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await request.json();

  if (!body.name || !body.domain) {
    return apiError("Name and domain are required");
  }

  let domain: string;
  try {
    domain = assertPublicDomain(body.domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain");
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) {
    return apiError("No organization found");
  }

  const competitors = Array.isArray(body.competitors)
    ? body.competitors.slice(0, 10).map((c: string) => String(c).slice(0, 80))
    : [];

  // Phase 22 — business-model intake for the operating plan (refund-safe context).
  const scope = ["local", "national", "global"].includes(body.scope) ? body.scope : undefined;
  const businessModel = {
    offer: body.main_offer ? String(body.main_offer).slice(0, 200) : undefined,
    conversion_goal: body.conversion_goal ? String(body.conversion_goal).slice(0, 120) : undefined,
    aov: typeof body.aov === "number" && body.aov >= 0 ? body.aov : undefined,
    ltv: typeof body.ltv === "number" && body.ltv >= 0 ? body.ltv : undefined,
    scope,
    monthly_ad_spend: typeof body.monthly_ad_spend === "number" ? body.monthly_ad_spend : undefined,
  };

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      organization_id: membership.organization_id,
      name: String(body.name).slice(0, 120),
      domain,
      industry: body.industry ? String(body.industry).slice(0, 80) : null,
      location: body.location ? String(body.location).slice(0, 120) : null,
      competitors,
      target_buyer: body.target_buyer ? String(body.target_buyer).slice(0, 200) : null,
      main_offer: body.main_offer ? String(body.main_offer).slice(0, 200) : null,
      conversion_goal: body.conversion_goal ? String(body.conversion_goal).slice(0, 120) : null,
      monthly_ad_spend: typeof body.monthly_ad_spend === "number" ? body.monthly_ad_spend : null,
      current_monthly_traffic: typeof body.current_monthly_traffic === "number" ? body.current_monthly_traffic : null,
      settings: { business_model: businessModel },
      status: "scanning",
    })
    .select()
    .single();

  if (error) return apiServerError("project create failed", error);

  await triggerProjectScan(project.id, membership.organization_id);

  return NextResponse.json({ project });
}
