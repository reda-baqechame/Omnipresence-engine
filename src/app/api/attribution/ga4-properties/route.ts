import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listGa4Properties } from "@/lib/engines/attribution";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const accessToken = await getValidOAuthToken(supabase, projectId, "google_analytics");
  if (!accessToken) {
    return NextResponse.json({ properties: [], currentPropertyId: null });
  }

  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("metadata")
    .eq("project_id", projectId)
    .eq("provider", "google_analytics")
    .single();

  const properties = await listGa4Properties(accessToken);
  const metadata = connection?.metadata as { property_id?: string } | null;

  return NextResponse.json({
    properties,
    currentPropertyId: metadata?.property_id || null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, propertyId } = await request.json();
  if (!projectId || !propertyId) {
    return apiError("projectId and propertyId required");
  }

  const access = await verifyProjectAccess(supabase, projectId, user.id, "admin");
  if (!access) return apiForbidden();

  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("metadata")
    .eq("project_id", projectId)
    .eq("provider", "google_analytics")
    .single();

  if (!connection) return apiNotFound();

  const metadata = {
    ...((connection.metadata as Record<string, unknown>) || {}),
    property_id: String(propertyId).slice(0, 64),
  };

  const { error } = await supabase
    .from("oauth_connections")
    .update({ metadata })
    .eq("project_id", projectId)
    .eq("provider", "google_analytics");

  if (error) return apiServerError("ga4 property update failed", error);
  return NextResponse.json({ success: true, propertyId });
}
