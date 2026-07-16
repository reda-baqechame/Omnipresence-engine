import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiServerError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { assertProjectLimit, PlanLimitExceededError } from "@/lib/plans/limits";
import { ProjectCreateSchema } from "@/lib/validation/schemas";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, ProjectCreateSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;

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

  // Enforce per-plan project cap (no-op while FREE_ACCESS_MODE is on).
  try {
    await assertProjectLimit(supabase, membership.organization_id);
  } catch (error) {
    if (error instanceof PlanLimitExceededError) return apiError(error.message, 402);
    return apiServerError("plan limit check failed", error);
  }

  const competitors = Array.isArray(body.competitors)
    ? body.competitors.slice(0, 10).map((c: string) => String(c).slice(0, 80))
    : [];

  // Phase 22 — business-model intake for the operating plan (refund-safe context).
  const scope = body.scope;
  const businessModel = {
    offer: body.main_offer ? String(body.main_offer).slice(0, 200) : undefined,
    conversion_goal: body.conversion_goal ? String(body.conversion_goal).slice(0, 120) : undefined,
    aov: typeof body.aov === "number" && body.aov >= 0 ? body.aov : undefined,
    ltv: typeof body.ltv === "number" && body.ltv >= 0 ? body.ltv : undefined,
    scope,
    monthly_ad_spend: typeof body.monthly_ad_spend === "number" ? body.monthly_ad_spend : undefined,
  };

  const settings: Record<string, unknown> = { business_model: businessModel };
  if (body.client_mode) settings.client_mode = body.client_mode;

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
      settings,
      status: "scanning",
    })
    .select()
    .single();

  if (error) return apiServerError("project create failed", error);

  // Onboarding prompt approval: persist the user-approved prompts BEFORE the
  // scan trigger so the scan runner tracks exactly what the user reviewed
  // instead of regenerating a universe they never saw.
  if (Array.isArray(body.approved_prompts) && body.approved_prompts.length > 0) {
    const promptRows = body.approved_prompts.slice(0, 60).map((p) => ({
      project_id: project.id,
      text: String(p.text).slice(0, 180),
      category: p.category ? String(p.category).slice(0, 32) : "solution_aware",
      priority: typeof p.priority === "number" ? Math.min(100, Math.max(1, p.priority)) : 80,
      is_tracked: true,
    }));
    const { error: promptError } = await supabase.from("prompts").insert(promptRows);
    if (promptError) {
      // Non-fatal: the scan runner falls back to generating a universe.
      console.error("approved prompt insert failed", promptError.message);
    }
  }

  await triggerProjectScan(project.id, membership.organization_id);

  return NextResponse.json({ project });
}
