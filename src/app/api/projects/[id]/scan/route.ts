import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runProjectScan, getOwnerEmail } from "@/lib/engines/scan-runner";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { ApiCreditExceededError } from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const serviceClient = await createServiceClient();
  const email = await getOwnerEmail(serviceClient, access.organizationId);

  try {
    const result = await runProjectScan(serviceClient, id, { notifyEmail: email });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiCreditExceededError) {
      return apiError("API credit limit exceeded. Upgrade your plan or wait for reset.", 402);
    }
    await serviceClient.from("projects").update({ status: "draft" }).eq("id", id);
    return apiServerError("scan failed", error);
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "viewer");
  if (!access) return apiNotFound();

  const { data: project } = await supabase.from("projects").select("status, last_scan_at").eq("id", id).single();
  if (!project) return apiNotFound();

  const { data: score } = await supabase
    .from("scores")
    .select("omnipresence_score")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    status: project.status,
    lastScanAt: project.last_scan_at,
    score: score?.omnipresence_score ?? null,
  });
}
