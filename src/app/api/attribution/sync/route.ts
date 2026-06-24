import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { syncProjectAttribution } from "@/lib/engines/attribution-sync";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId } = await request.json();
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (process.env.INNGEST_EVENT_KEY) {
    try {
      await inngest.send({
        name: "project/attribution.sync",
        data: { projectId },
      });
      return NextResponse.json({ success: true, mode: "inngest" });
    } catch {
      // Fall through to sync
    }
  }

  const service = await createServiceClient();
  const result = await syncProjectAttribution(service, projectId);
  if (!result.success) {
    return apiServerError("attribution sync failed", result.error);
  }

  return NextResponse.json({ success: true, mode: "sync" });
}
