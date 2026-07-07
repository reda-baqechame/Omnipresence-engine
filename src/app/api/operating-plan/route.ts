import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { OperatingPlanPostSchema } from "@/lib/validation/schemas";
import {
  buildOperatingPlan,
  runCadenceReview,
  gatherOperationalGuarantees,
  type BusinessModel,
  type Cadence,
} from "@/lib/engines/continuous-loop";

const CADENCES: Cadence[] = ["daily", "weekly", "monthly", "quarterly"];

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const [{ data: plan }, { data: reviews }, guarantees] = await Promise.all([
    supabase.from("operating_plans").select("*").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("operating_reviews")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(8),
    gatherOperationalGuarantees(supabase, projectId),
  ]);

  return NextResponse.json({ plan: plan ?? null, reviews: reviews ?? [], guarantees });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, OperatingPlanPostSchema);
  if (v.response) return v.response;
  const body = v.data as {
    projectId: string;
    action: "generate_plan" | "run_review";
    businessModel?: BusinessModel;
    cadence?: Cadence;
  };
  const { projectId, action } = body;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (action === "generate_plan") {
    const plan = await buildOperatingPlan(supabase, projectId, body.businessModel || {});
    return NextResponse.json({ ok: true, plan });
  }

  if (action === "run_review") {
    const cadence = body.cadence && CADENCES.includes(body.cadence) ? body.cadence : "weekly";
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (!project) return apiError("Project not found");
    const digest = await runCadenceReview(supabase, projectId, project.organization_id, cadence);
    return NextResponse.json({ ok: true, digest });
  }

  return apiError("Unknown action");
}
