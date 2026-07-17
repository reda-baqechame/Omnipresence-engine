import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { ApiCreditExceededError, TenantBudgetExceededError } from "@/lib/metering/api-usage";
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

  // Atomic claim: only the request that actually flips the project out of
  // "scanning" gets to trigger a run. This closes the double-click race for
  // callers that omit idempotency_key too (a near-simultaneous second POST
  // sees zero rows updated and is a no-op), per the idempotency plan.
  const { data: claimed } = await supabase
    .from("projects")
    .update({ status: "scanning" })
    .eq("id", id)
    .neq("status", "scanning")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return NextResponse.redirect(`${appUrl}/app/projects/${id}?scanning=true`);
  }

  try {
    await triggerProjectScan(id, access.organizationId, {
      idempotencyKey: parsed.data.idempotency_key,
    });
  } catch (error) {
    if (error instanceof ApiCreditExceededError || error instanceof TenantBudgetExceededError) {
      // This endpoint is hit by a plain HTML form — a JSON 402 would render as
      // raw text. Release the scan claim and land the user on the project page
      // with an upgrade banner instead.
      await supabase.from("projects").update({ status: "active" }).eq("id", id);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      return NextResponse.redirect(`${appUrl}/app/projects/${id}?limit=budget`);
    }
    return apiServerError("rescan failed", error);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return NextResponse.redirect(`${appUrl}/app/projects/${id}?scanning=true`);
}
