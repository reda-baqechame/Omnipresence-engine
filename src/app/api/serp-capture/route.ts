import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { SerpCaptureSchema } from "@/lib/validation/schemas";
import {
  generateSnippetBlock,
  type SnippetFormat,
} from "@/lib/engines/serp-capture";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("snippet_opportunities")
    .select("keyword, feature, current_position, recommended_format, owned")
    .eq("project_id", projectId)
    .order("owned", { ascending: true })
    .limit(200);

  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, SerpCaptureSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const { projectId, keyword } = body;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);
  const brand = project.name || project.domain;

  const result = await generateSnippetBlock({ keyword, format: "paragraph" as SnippetFormat, brand });
  return NextResponse.json(result);
}
