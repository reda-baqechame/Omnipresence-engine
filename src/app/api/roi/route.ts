import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { syncGa4LandingPages } from "@/lib/engines/attribution";
import { buildCommandCenter, buildUxEmbeds } from "@/lib/engines/roi-command-center";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const summary = await buildCommandCenter(supabase, projectId);

  // Optional UX-layer links from saved integration metadata (read-only).
  let uxEmbeds: ReturnType<typeof buildUxEmbeds> = [];
  const { data: project } = await supabase
    .from("projects")
    .select("settings")
    .eq("id", projectId)
    .single();
  const settings = (project?.settings || {}) as { clarity_project_id?: string; hotjar_site_id?: string };
  uxEmbeds = buildUxEmbeds({
    clarityProjectId: settings.clarity_project_id,
    hotjarSiteId: settings.hotjar_site_id,
  });

  return NextResponse.json({ summary, uxEmbeds });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await readJsonBody(request) as {
    projectId: string;
    action: "landing_pages" | "save_ux";
    clarityProjectId?: string;
    hotjarSiteId?: string;
  };
  const { projectId, action } = body;
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (action === "save_ux") {
    const { data: project } = await supabase
      .from("projects")
      .select("settings")
      .eq("id", projectId)
      .single();
    const settings = {
      ...((project?.settings as Record<string, unknown>) || {}),
      clarity_project_id: (body.clarityProjectId || "").slice(0, 64) || undefined,
      hotjar_site_id: (body.hotjarSiteId || "").slice(0, 64) || undefined,
    };
    await supabase.from("projects").update({ settings }).eq("id", projectId);
    return NextResponse.json({ ok: true });
  }

  if (action === "landing_pages") {
    const token = await getValidOAuthToken(supabase, projectId, "google_analytics");
    if (!token) {
      return NextResponse.json({
        available: false,
        reason: "Connect Google Analytics (GA4) to see revenue by landing page.",
      });
    }
    const { data: connection } = await supabase
      .from("oauth_connections")
      .select("metadata")
      .eq("project_id", projectId)
      .eq("provider", "google_analytics")
      .single();
    const propertyId = (connection?.metadata as { property_id?: string } | null)?.property_id;
    if (!propertyId) {
      return NextResponse.json({ available: false, reason: "Select a GA4 property in the Attribution tab first." });
    }

    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const pages = await syncGa4LandingPages(token, propertyId, start, end, 50);
    return NextResponse.json({ available: pages.length > 0, landingPages: pages });
  }

  return apiError("Unknown action");
}
