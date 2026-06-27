import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiUnauthorized } from "@/lib/security/api-response";
import {
  auditGbpProfile,
  runMapGrid,
  captureReviewSnapshot,
  checkNapConsistency,
  generateLocalLandingPage,
} from "@/lib/engines/local-seo";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data: grids } = await supabase
    .from("local_grid_scans")
    .select("id, keyword, avg_rank, found_cells, total_cells, grid_size, cells, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: reviews } = await supabase
    .from("review_snapshots")
    .select("rating, review_count, captured_at")
    .eq("project_id", projectId)
    .order("captured_at", { ascending: false })
    .limit(30);

  return NextResponse.json({ grids: grids || [], reviews: reviews || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await request.json();
  const { projectId, action, keyword, gridSize, radiusKm, service, city } = body as {
    projectId: string;
    action: "gbp_audit" | "map_grid" | "reviews" | "nap" | "local_page";
    keyword?: string;
    gridSize?: number;
    radiusKm?: number;
    service?: string;
    city?: string;
  };
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("name, domain, location")
    .eq("id", projectId)
    .single();
  if (!project) return apiError("Project not found", 404);

  const base = { name: project.name, domain: project.domain, location: project.location || undefined };

  if (action === "gbp_audit") {
    return NextResponse.json(await auditGbpProfile(base));
  }

  if (action === "map_grid") {
    if (!keyword) return apiError("keyword required for map_grid");
    return NextResponse.json(
      await runMapGrid(supabase, { projectId, keyword, ...base, gridSize, radiusKm })
    );
  }

  if (action === "reviews") {
    return NextResponse.json(await captureReviewSnapshot(supabase, { projectId, ...base }));
  }

  if (action === "nap") {
    return NextResponse.json(await checkNapConsistency(base));
  }

  if (action === "local_page") {
    if (!service || !city) return apiError("service and city required for local_page");
    return NextResponse.json(
      generateLocalLandingPage({ name: project.name, domain: project.domain, service, city })
    );
  }

  return apiError("Unknown action");
}
