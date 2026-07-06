import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { ApiCreditExceededError } from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { RescanSchema } from "@/lib/validation/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const parsed = await validateBody(request, RescanSchema);
  if (parsed.response) return parsed.response;

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  try {
    await supabase.from("projects").update({ status: "scanning" }).eq("id", id);
    await triggerProjectScan(id, access.organizationId);
  } catch (error) {
    if (error instanceof ApiCreditExceededError) {
      return apiError("API credit limit exceeded. Upgrade your plan.", 402);
    }
    return apiServerError("rescan failed", error);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(`${appUrl}/app/projects/${id}?scanning=true`);
}
