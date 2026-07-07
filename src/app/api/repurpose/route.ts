import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { RepurposePatchSchema, RepurposePostSchema } from "@/lib/validation/schemas";
import { repurposeAndStore, advanceStage, REPURPOSE_TARGETS, type LifecycleStage } from "@/lib/engines/distribution-engine";
import type { ContentAssetType } from "@/types/database";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "viewer");
  if (!access) return apiForbidden();

  const { data } = await supabase
    .from("distribution_jobs")
    .select("id, asset_id, destination, stage, scheduled_at, published_url, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(200);

  return NextResponse.json({ jobs: data || [], targets: REPURPOSE_TARGETS });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, RepurposePostSchema);
  if (v.response) return v.response;
  const { assetId, targets } = v.data;

  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, project_id, title, type, content")
    .eq("id", assetId)
    .single();
  if (!asset) return apiNotFound();

  const access = await verifyProjectAccess(supabase, asset.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const { data: brand } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("project_id", asset.project_id)
    .single();
  if (!brand) return apiError("Brand profile required to repurpose. Complete onboarding first.");

  const chosen = (targets && targets.length ? targets : REPURPOSE_TARGETS.map((t) => t.type)) as ContentAssetType[];

  const results = await repurposeAndStore(supabase, {
    projectId: asset.project_id,
    parentAssetId: asset.id,
    parentType: asset.type,
    parentTitle: asset.title,
    parentContent: asset.content || "",
    brand,
    targets: chosen,
  });

  return NextResponse.json({ created: results.length, results });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const v = await validateBody(request, RepurposePatchSchema);
  if (v.response) return v.response;
  const { jobId, stage, publishedUrl, scheduledAt } = v.data as {
    jobId: string;
    stage: LifecycleStage;
    publishedUrl?: string;
    scheduledAt?: string;
  };

  const { data: job } = await supabase
    .from("distribution_jobs")
    .select("project_id")
    .eq("id", jobId)
    .single();
  if (!job) return apiNotFound();

  const access = await verifyProjectAccess(supabase, job.project_id, user.id, "member");
  if (!access) return apiForbidden();

  await advanceStage(supabase, jobId, stage, {
    published_url: publishedUrl,
    scheduled_at: scheduledAt,
  });

  return NextResponse.json({ ok: true });
}
