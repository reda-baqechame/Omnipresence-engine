import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

/**
 * Kick off the measured GEO rewrite loop for a page: AutoGEO rewrite -> deploy
 * artifact -> wait for propagation -> re-probe -> measure citation lift ->
 * results-ledger. The loop spans days, so it runs as a durable Inngest flow.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let body: { projectId?: string; url?: string; waitDays?: number };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }
  const { projectId, url, waitDays } = body;
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  if (!process.env.INNGEST_EVENT_KEY) {
    return apiError(
      "The GEO rewrite loop requires background jobs (Inngest). Configure INNGEST_EVENT_KEY.",
      503
    );
  }

  await inngest.send({
    name: "project/geo-rewrite.requested",
    data: { projectId, organizationId: project.organization_id, url, waitDays },
  });

  return NextResponse.json({ success: true, mode: "inngest" });
}
