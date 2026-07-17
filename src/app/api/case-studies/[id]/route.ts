import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, apiServerError, validateBody } from "@/lib/security/api-response";
import { CaseStudyPatchSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/case-studies/[id] — publish (requires explicit named consent) or
 * unpublish. Only org members with project access can change publish state.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(req, CaseStudyPatchSchema);
  if (parsed.response) return parsed.response;

  const { data: caseStudy } = await supabase
    .from("case_studies")
    .select("id, project_id, published")
    .eq("id", id)
    .maybeSingle();
  if (!caseStudy) return apiError("Case study not found", 404);

  const access = await verifyProjectAccess(supabase, caseStudy.project_id, user.id, "member");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const update =
    parsed.data.action === "publish"
      ? {
          published: true,
          consent_confirmed: true,
          published_at: new Date().toISOString(),
        }
      : { published: false, published_at: null };

  const { data: updated, error } = await supabase
    .from("case_studies")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) return apiServerError("case study update failed", error);
  return NextResponse.json({ caseStudy: updated });
}

/** DELETE /api/case-studies/[id] — remove a draft or published case study. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { data: caseStudy } = await supabase
    .from("case_studies")
    .select("id, project_id")
    .eq("id", id)
    .maybeSingle();
  if (!caseStudy) return apiError("Case study not found", 404);

  const access = await verifyProjectAccess(supabase, caseStudy.project_id, user.id, "admin");
  if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await supabase.from("case_studies").delete().eq("id", id);
  if (error) return apiServerError("case study delete failed", error);
  return NextResponse.json({ deleted: true });
}
