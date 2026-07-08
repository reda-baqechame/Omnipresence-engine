import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { getConnectorHealth } from "@/lib/engines/connector-health";
import {
  getSearchConsoleSnapshot,
  getGa4Snapshot,
  getBingWebmasterSnapshot,
} from "@/lib/providers/first-party-analytics";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const report = await getConnectorHealth(supabase, projectId);

  // Live GSC/GA4/Bing numbers require a real outbound call to each connected
  // API, so they're opt-in (?includeSnapshots=true) rather than fetched on
  // every poll of this otherwise DB-only, cheap health check.
  if (request.nextUrl.searchParams.get("includeSnapshots") === "true") {
    const { data: project } = await supabase
      .from("projects")
      .select("domain")
      .eq("id", projectId)
      .maybeSingle();
    const domain = project?.domain as string | undefined;

    const [searchConsole, ga4, bingWebmaster] = await Promise.all([
      domain ? getSearchConsoleSnapshot(supabase, projectId, domain) : Promise.resolve(null),
      getGa4Snapshot(supabase, projectId),
      domain ? getBingWebmasterSnapshot(supabase, projectId, domain) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      ...report,
      snapshots: { google_search_console: searchConsole, google_analytics: ga4, bing_webmaster: bingWebmaster },
    });
  }

  return NextResponse.json(report);
}
