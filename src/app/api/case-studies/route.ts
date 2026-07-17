import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, apiServerError, validateBody } from "@/lib/security/api-response";
import { CaseStudyCreateSchema } from "@/lib/validation/schemas";
import { buildCaseStudyDraft, caseStudySlug } from "@/lib/engines/case-study";

/** GET /api/case-studies?projectId= — this project's case studies (drafts + published). */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();
  const access = await verifyProjectAccess(supabase, projectId, user.id);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("case_studies")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return apiServerError("case study list failed", error);
  return NextResponse.json({ caseStudies: data || [] });
}

/**
 * POST /api/case-studies — draft a case study from measured sprint history.
 * Fails honestly when the project has no completed before/after sprint yet;
 * a case study can never be created from thin air.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(req, CaseStudyCreateSchema);
  if (parsed.response) return parsed.response;

  const access = await verifyProjectAccess(supabase, parsed.data.projectId, user.id, "member");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { draft, reason } = await buildCaseStudyDraft(
    supabase,
    parsed.data.projectId,
    parsed.data.brandName
  );
  if (!draft) return apiError(reason || "No measured data for a case study yet.", 409);

  const { data: caseStudy, error } = await supabase
    .from("case_studies")
    .insert({
      organization_id: access.organizationId,
      project_id: parsed.data.projectId,
      slug: caseStudySlug(parsed.data.brandName),
      title: draft.title,
      summary: draft.summary,
      brand_name: parsed.data.brandName,
      agency_name: parsed.data.agencyName || null,
      baseline: draft.baseline,
      outcome: draft.outcome,
      outcome_verdict: draft.outcomeVerdict,
      receipt_ids: draft.receiptIds,
    })
    .select()
    .single();
  if (error) return apiServerError("case study create failed", error);
  return NextResponse.json({ caseStudy });
}
