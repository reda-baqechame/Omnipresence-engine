import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOutreachEmail, sendOutreachEmail } from "@/lib/engines/authority-finder";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { trackApiUsage } from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

const VALID_STATUSES = new Set([
  "identified",
  "researched",
  "pitched",
  "followed_up",
  "accepted",
  "published",
  "rejected",
]);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: opportunities, error } = await supabase
    .from("authority_opportunities")
    .select("*")
    .eq("project_id", projectId)
    .order("estimated_impact", { ascending: false });

  if (error) return apiServerError("authority list failed", error);
  return NextResponse.json({ opportunities: opportunities || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { opportunityId } = await readJsonBody(request);
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

  const { opportunityId, status } = await readJsonBody(request);
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

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { opportunityId, to, subject } = await readJsonBody(request);
  if (!opportunityId || !to) return apiError("opportunityId and to required");

  const { data: opportunity } = await supabase
    .from("authority_opportunities")
    .select("*, projects(name)")
    .eq("id", opportunityId)
    .single();

  if (!opportunity) return apiNotFound();

  const access = await verifyProjectAccess(supabase, opportunity.project_id, user.id, "admin");
  if (!access) return apiForbidden();

  const body = opportunity.outreach_email || "";
  const emailSubject = subject || `Partnership opportunity — ${(opportunity.projects as { name: string })?.name}`;
  const sent = await sendOutreachEmail(to, emailSubject, body);

  if (sent.success) {
    await supabase
      .from("authority_opportunities")
      .update({ status: "pitched", contact_email: to })
      .eq("id", opportunityId);
  }

  return NextResponse.json(sent);
}
