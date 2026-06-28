import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { runFanoutInterception } from "@/lib/engines/fanout-interceptor";
import { findCitationGaps } from "@/lib/engines/citation-gap";
import { generateEarnedMediaPlan } from "@/lib/engines/earned-media";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const result = await findCitationGaps(supabase, projectId);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request);
  const { projectId, action, prompt } = body as {
    projectId: string;
    action: "fanout" | "citation_gaps" | "earned_media";
    prompt?: string;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, industry, competitors")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const competitors = (project.competitors || []) as string[];

  if (action === "fanout") {
    if (!prompt) return apiError("prompt required for fanout");
    const result = await runFanoutInterception(prompt, project.domain, competitors);
    return NextResponse.json(result);
  }

  if (action === "citation_gaps") {
    const result = await findCitationGaps(supabase, projectId);
    return NextResponse.json(result);
  }

  if (action === "earned_media") {
    if (!prompt) return apiError("prompt required for earned_media");
    const result = await generateEarnedMediaPlan({
      brand: project.name || project.domain,
      domain: project.domain,
      prompt,
      industry: project.industry || undefined,
    });
    return NextResponse.json(result);
  }

  return apiError("Unknown action");
}
