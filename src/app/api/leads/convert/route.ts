import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";
import { assertPublicDomain, DomainValidationError } from "@/lib/security/domain";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { LeadsConvertSchema } from "@/lib/validation/schemas";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const parsed = await validateBody(request, LeadsConvertSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const { leadId, organizationName } = body;

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return apiError("No organization found");
  if (!["owner", "admin"].includes(membership.role)) {
    return apiForbidden();
  }

  const { data: lead } = await supabase
    .from("audit_leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (!lead) return apiNotFound();

  if (!lead.organization_id || lead.organization_id !== membership.organization_id) {
    return apiError("Lead does not belong to your organization", 403);
  }

  let domain: string;
  try {
    domain = assertPublicDomain(lead.domain);
  } catch (error) {
    if (error instanceof DomainValidationError) return apiError(error.message);
    return apiError("Invalid domain on lead");
  }

  const name = organizationName || lead.brand_name || domain.split(".")[0];

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      organization_id: membership.organization_id,
      name: String(name).slice(0, 120),
      domain,
      industry: lead.industry ? String(lead.industry).slice(0, 80) : null,
      status: "scanning",
    })
    .select()
    .single();

  if (error) return apiServerError("project create failed", error);

  await triggerProjectScan(project.id, membership.organization_id);

  return NextResponse.json({ project, leadEmail: lead.email });
}
