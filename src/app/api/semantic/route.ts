import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { detectCannibalization, clusterTexts, hasEmbeddingsCapability } from "@/lib/engines/semantic";
import { runSiteCrawl } from "@/lib/engines/site-crawler";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let body: { projectId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }
  const { projectId, action } = body;
  if (!projectId || !action) return apiError("projectId and action required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (!hasEmbeddingsCapability()) {
    return NextResponse.json({
      available: false,
      reason: "Semantic engine needs OmniData embeddings (set OMNIDATA_BASE_URL).",
    });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  if (action === "cannibalization") {
    const crawl = await runSiteCrawl(project.domain, 40);
    const items = crawl.pages
      .filter((p) => p.status === 200 && p.title)
      .map((p) => ({ ref: p.url, text: `${p.title}` }));
    const result = await detectCannibalization(items);
    return NextResponse.json(result);
  }

  if (action === "cluster") {
    const { data: kws } = await supabase
      .from("keyword_opportunities")
      .select("keyword")
      .eq("project_id", projectId)
      .limit(64);
    const result = await clusterTexts((kws || []).map((k) => k.keyword));
    return NextResponse.json(result);
  }

  return apiError("Unknown action");
}
