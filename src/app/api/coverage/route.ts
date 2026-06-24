import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized } from "@/lib/security/api-response";

const DIRECTORY_SURFACES = new Set([
  "g2",
  "capterra",
  "trustpilot",
  "yelp",
  "directory",
  "review_site",
]);

const VALID_STATUSES = new Set(["not_started", "in_progress", "submitted", "live"]);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data, error } = await supabase
    .from("coverage_items")
    .select("*")
    .eq("project_id", projectId)
    .in("surface", [...DIRECTORY_SURFACES])
    .order("platform_name");

  if (error) return apiServerError("coverage fetch failed", error);
  return NextResponse.json({ items: data || [] });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { itemId, submissionStatus, profileUrl, notes } = await request.json();
  if (!itemId) return apiError("itemId required");

  const { data: item } = await supabase
    .from("coverage_items")
    .select("project_id, surface")
    .eq("id", itemId)
    .single();

  if (!item) return apiNotFound();
  if (!DIRECTORY_SURFACES.has(item.surface)) {
    return apiError("Not a directory coverage item");
  }

  const access = await verifyProjectAccess(supabase, item.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const updates: Record<string, unknown> = {};
  if (submissionStatus !== undefined) {
    if (!VALID_STATUSES.has(submissionStatus)) return apiError("Invalid submission status");
    updates.submission_status = submissionStatus;
    if (submissionStatus === "submitted" || submissionStatus === "live") {
      updates.submitted_at = new Date().toISOString();
    }
    if (submissionStatus === "live") {
      updates.is_present = true;
    }
  }
  if (profileUrl !== undefined) {
    updates.profile_url = profileUrl ? String(profileUrl).slice(0, 500) : null;
  }
  if (notes !== undefined) {
    updates.notes = notes ? String(notes).slice(0, 500) : null;
  }

  const { data, error } = await supabase
    .from("coverage_items")
    .update(updates)
    .eq("id", itemId)
    .select()
    .single();

  if (error) return apiServerError("coverage update failed", error);
  return NextResponse.json({ item: data });
}
