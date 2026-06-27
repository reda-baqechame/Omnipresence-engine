import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { buildGscInsights } from "@/lib/engines/gsc-queries";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();
  if (!project?.domain) return apiError("Project not found", 404);

  const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
  if (!token) {
    // Honest "unavailable" — never a false zero. Prompt the user to connect GSC.
    return NextResponse.json({
      available: false,
      reason: "Google Search Console is not connected for this project.",
    });
  }

  const insights = await buildGscInsights(token, project.domain);
  return NextResponse.json(insights);
}
