import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { DemandRefreshSchema } from "@/lib/validation/schemas";
import { discoverRisingTopics } from "@/lib/engines/demand-discovery";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, DemandRefreshSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const { projectId, seeds } = body;

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, industry")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const seedTopic = seeds?.[0] || project.industry || project.name;
  if (!seedTopic) return apiError("seeds or project industry required");

  const result = await discoverRisingTopics({ seed: seedTopic });

  return NextResponse.json(result);
}
