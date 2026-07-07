import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { ContentScoreSchema } from "@/lib/validation/schemas";
import { optimizeContent } from "@/lib/engines/content-optimizer";
import { runEditorialQA } from "@/lib/engines/editorial-qa";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, ContentScoreSchema);
  if (v.response) return v.response;
  const { projectId, keyword, draftText, targetUrl } = v.data;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const result = await optimizeContent({
    keyword: keyword.slice(0, 120),
    draftText: draftText?.slice(0, 100_000),
    targetUrl: targetUrl?.slice(0, 500),
    excludeDomain: project.domain,
  });

  // Editorial QA pass on the draft (readability, keyphrases, language, grammar).
  let editorial = null;
  if (draftText && draftText.trim().length > 20) {
    editorial = await runEditorialQA(draftText.slice(0, 100_000), { checkGrammar: true });
  }

  return NextResponse.json({ ...result, editorial });
}
