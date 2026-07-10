import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { buildGscInsights } from "@/lib/engines/gsc-queries";
import {
  mineGscOpportunitiesFromInsights,
  mineGscOpportunitiesFromRanks,
} from "@/lib/engines/searchops-command-center";
import {
  clusterStrikingDistanceByTargetUrl,
  enrichStrikingDistanceWithClusters,
  mineCannibalizationOpportunities,
} from "@/lib/engines/searchops-gsc-miner";
import { buildSearchOpsOpportunities } from "@/lib/engines/searchops-opportunity-engine";

export const runtime = "nodejs";

/**
 * Explicit GSC opportunity refresh — not used during SSR.
 * Returns evidence-backed SearchOps opportunities from live GSC when connected.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("id, domain, name")
    .eq("id", projectId)
    .single();
  if (!project?.domain) return apiError("Project not found", 404);

  const { data: rankKeywords } = await supabase
    .from("rank_keywords")
    .select("keyword, last_position, is_striking_distance, cannibalization_urls, target_url")
    .eq("project_id", projectId)
    .order("last_position", { ascending: true })
    .limit(80);

  const rankRows = rankKeywords || [];
  let gscOpportunities = mineGscOpportunitiesFromRanks(rankRows);
  const strikeQueries = gscOpportunities
    .filter((o) => o.kind === "striking_distance")
    .map((o) => o.queryOrUrl);
  const clusters = clusterStrikingDistanceByTargetUrl(rankRows, strikeQueries);
  gscOpportunities = enrichStrikingDistanceWithClusters(gscOpportunities, clusters, rankRows);
  const cannibalization = mineCannibalizationOpportunities(projectId, rankRows);
  let gscConnected = false;
  let liveGsc = false;

  const token = await getValidOAuthToken(supabase, projectId, "google_search_console");
  if (!token) {
    // Still return measured rank SERP opportunities (striking distance + cannibalization).
    // Do not blank gscOpportunities — that previously hid rank signals when GSC was off.
    const opportunities = buildSearchOpsOpportunities({
      projectId,
      brandName: project.name,
      gscConnected: false,
      gscOpportunities,
      extraOpportunities: cannibalization,
    });
    return NextResponse.json({
      available: false,
      reason:
        "Google Search Console is not connected for this project. Rank-tracker SERP opportunities are still included when measured.",
      opportunities: opportunities.filter((o) => o.category === "gsc" || o.category === "serp"),
      liveGsc: false,
    });
  }

  gscConnected = true;
  try {
    const insights = await buildGscInsights(token, project.domain);
    const fromGsc = mineGscOpportunitiesFromInsights(insights);
    if (fromGsc.length) {
      liveGsc = true;
      const gscKeys = new Set(fromGsc.map((o) => o.queryOrUrl.toLowerCase()));
      const rankOnly = gscOpportunities.filter((o) => !gscKeys.has(o.queryOrUrl.toLowerCase()));
      const merged = [...fromGsc, ...rankOnly].slice(0, 25);
      gscOpportunities = enrichStrikingDistanceWithClusters(merged, clusters, rankRows);
    }
  } catch {
    // Keep rank_keywords mining only.
  }

  const opportunities = buildSearchOpsOpportunities({
    projectId,
    brandName: project.name,
    gscConnected,
    gscOpportunities,
    extraOpportunities: cannibalization,
  }).filter((o) => o.category === "gsc" || o.category === "serp");

  return NextResponse.json({
    available: true,
    liveGsc,
    count: opportunities.length,
    opportunities,
  });
}
