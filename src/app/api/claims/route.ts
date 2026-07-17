import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, apiServerError, validateBody } from "@/lib/security/api-response";
import { ClaimReviewCreateSchema } from "@/lib/validation/schemas";
import { runClaimReview, saveClaimReview } from "@/lib/engines/claim-review";
import { guardOrgEndpoint } from "@/lib/security/api-v1-guard";

// Reviews up to 12 receipts with parallel LLM calls + a homepage fetch — needs
// more than the default function budget.
export const maxDuration = 120;

/** GET /api/claims?projectId= — review history, newest first. */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();
  const access = await verifyProjectAccess(supabase, projectId, user.id);
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await supabase
    .from("claim_reviews")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return apiServerError("claim review list failed", error);
  return NextResponse.json({ reviews: data || [] });
}

/** POST /api/claims — run a false-claim review over the project's receipts. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(req, ClaimReviewCreateSchema);
  if (parsed.response) return parsed.response;

  const access = await verifyProjectAccess(supabase, parsed.data.projectId, user.id, "member");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // LLM-metered endpoint — bound how often one org can hammer it.
  const limited = await guardOrgEndpoint(access.organizationId, "claim-review", 6, 60 * 60 * 1000);
  if (limited) return limited;

  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id, name, domain")
    .eq("id", parsed.data.projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const result = await runClaimReview(supabase, {
    id: project.id,
    organization_id: project.organization_id,
    brand_name: project.name,
    domain: project.domain,
  });
  const reviewId = await saveClaimReview(supabase, project, result);

  return NextResponse.json({
    review: {
      id: reviewId,
      status: result.status,
      claims: result.claims,
      answers_reviewed: result.answersReviewed,
      flagged_count: result.flaggedCount,
      reason: result.reason,
      created_at: new Date().toISOString(),
    },
  });
}
