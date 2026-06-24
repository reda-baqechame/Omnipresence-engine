import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachEmail } from "@/lib/engines/authority-finder";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { trackApiUsage } from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

const VALID_STATUSES = new Set([
  "identified",
  "researched",
  "pitched",
  "followed_up",
  "accepted",
  "published",
  "rejected",
]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { opportunityId } = await request.json();
  if (!opportunityId) return apiError("opportunityId required");

  const { data: opportunity } = await supabase
    .from("authority_opportunities")
    .select("*, projects(name)")
    .eq("id", opportunityId)
    .single();

  if (!opportunity) return apiNotFound();

  const access = await verifyProjectAccess(supabase, opportunity.project_id, user.id, "member");
  if (!access) return apiForbidden();

  await trackApiUsage(supabase, access.organizationId, "openai", "authority_outreach", 3);

  const brandName = (opportunity.projects as { name: string })?.name || "Brand";
  const emails = await generateOutreachEmail(brandName, opportunity);

  const { data, error } = await supabase
    .from("authority_opportunities")
    .update({
      outreach_email: emails.email,
      follow_up_email: emails.followUp,
      status: "researched",
    })
    .eq("id", opportunityId)
    .select()
    .single();

  if (error) return apiServerError("authority update failed", error);
  return NextResponse.json({ opportunity: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { opportunityId, status } = await request.json();
  if (!opportunityId || !status) return apiError("opportunityId and status required");
  if (!VALID_STATUSES.has(status)) return apiError("Invalid status");

  const { data: opportunity } = await supabase
    .from("authority_opportunities")
    .select("project_id")
    .eq("id", opportunityId)
    .single();

  if (!opportunity) return apiNotFound();

  const access = await verifyProjectAccess(supabase, opportunity.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const { data, error } = await supabase
    .from("authority_opportunities")
    .update({ status })
    .eq("id", opportunityId)
    .select()
    .single();

  if (error) return apiServerError("authority update failed", error);
  return NextResponse.json({ opportunity: data });
}
