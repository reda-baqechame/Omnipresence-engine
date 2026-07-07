import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { ProjectMutationSchema } from "@/lib/validation/schemas";
import { analyzeVideoSeo } from "@/lib/engines/video-seo";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, ProjectMutationSchema);
  if (v.response) return v.response;
  const { projectId, keywords: inputKeywords } = v.data as { projectId: string; keywords?: string[] };

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, competitors, industry")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  let keywords = (inputKeywords || []).map((k) => String(k)).filter(Boolean);
  if (keywords.length === 0) {
    const { data: kws } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .order("opportunity_score", { ascending: false })
      .limit(12);
    keywords = (kws || []).map((k) => k.keyword);
  }
  if (keywords.length === 0 && project.industry) keywords = [project.industry];
  if (keywords.length === 0) keywords = [project.domain.replace(/^www\./, "").split(".")[0]];

  const result = await analyzeVideoSeo({
    keywords,
    brand: project.name || project.domain,
    domain: project.domain,
    competitors: (project.competitors || []) as string[],
  });

  return NextResponse.json(result);
}
