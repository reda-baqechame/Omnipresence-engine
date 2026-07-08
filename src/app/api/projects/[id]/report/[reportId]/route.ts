import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiForbidden, apiNotFound, apiServerError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { ReportVisibilitySchema } from "@/lib/validation/schemas";

/**
 * Toggle a report's public share-link access. Every report is created with
 * `is_public: true` (the share_token is an unguessable 128-bit capability
 * URL) and, until this endpoint existed, there was no way for a user to ever
 * revoke that link short of a direct DB edit — a report shared once (or
 * whose link leaked) stayed downloadable by anyone with the URL forever.
 * Turning `is_public` off makes /report/[token], /portal/[token], and the
 * PDF download route all 404/reject immediately (see is_public checks
 * there) without invalidating or rotating the token itself.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const parsed = await validateBody(request, ReportVisibilitySchema);
  if (parsed.response) return parsed.response;
  const { is_public } = parsed.data;

  const service = await createServiceClient();
  const { data: updated, error } = await service
    .from("reports")
    .update({ is_public })
    .eq("id", reportId)
    .eq("project_id", id)
    .select("id, is_public, share_token")
    .maybeSingle();

  if (error) return apiServerError("report visibility update failed", error);
  if (!updated) return apiNotFound();

  return NextResponse.json({ id: updated.id, is_public: updated.is_public });
}
