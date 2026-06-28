import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateContent } from "@/lib/engines/content-generator";
import { assertContentGenerationAllowed } from "@/lib/engines/content-guardrails";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { trackApiUsage } from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { advancePipeline, type BlogPipelineStepKey } from "@/lib/engines/blog-pipeline";
import type { ContentAssetType } from "@/types/database";

const VALID_TYPES = new Set<ContentAssetType>([
  "service_page",
  "location_page",
  "comparison_page",
  "best_of_page",
  "faq_page",
  "blog_brief",
  "blog_post",
  "case_study",
  "youtube_script",
  "shorts_script",
  "linkedin_post",
  "x_thread",
  "reddit_draft",
  "quora_draft",
  "newsletter",
  "podcast_script",
  "gbp_post",
  "directory_description",
]);

const VALID_STATUSES = new Set([
  "drafted",
  "approved",
  "published",
  "indexed",
  "getting_traffic",
  "needs_refresh",
]);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, type, topic, additionalContext, parentAssetId, repurposeFrom, action } = await readJsonBody(request) as {
    projectId: string;
    type?: ContentAssetType;
    topic?: string;
    additionalContext?: string;
    parentAssetId?: string;
    repurposeFrom?: string;
    action?: "repurpose_chain";
  };

  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: brandProfile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("project_id", projectId)
    .single();

  if (action === "repurpose_chain" && repurposeFrom) {
    const { data: parent } = await supabase.from("content_assets").select("*").eq("id", repurposeFrom).single();
    if (!parent) return apiNotFound();

    const { HUB_SPOKE_TYPES, repurposeHubAsset } = await import("@/lib/engines/content-generator");
    const spokes = HUB_SPOKE_TYPES[parent.type as ContentAssetType] || [
      "faq_page",
      "linkedin_post",
      "x_thread",
      "newsletter",
    ];
    const created = [];
    for (const spokeType of spokes.slice(0, 8)) {
      const spamCheck = await assertContentGenerationAllowed(supabase, projectId, spokeType);
      if (!spamCheck.allowed) break;
      const content = await repurposeHubAsset(
        parent.type as ContentAssetType,
        parent.title,
        parent.content || "",
        brandProfile || { brand_name: "Brand" },
        spokeType
      );
      const { data: asset } = await supabase
        .from("content_assets")
        .insert({
          project_id: projectId,
          type: spokeType,
          title: content.title,
          content: content.content,
          metadata: { ...content.metadata, repurpose_chain: true },
          status: "drafted",
          parent_asset_id: repurposeFrom,
        })
        .select()
        .single();
      if (asset) created.push(asset);
    }
    return NextResponse.json({ assets: created, count: created.length });
  }

  if (!type || !topic?.trim()) {
    return apiError("type and topic required");
  }

  if (!VALID_TYPES.has(type)) return apiError("Invalid content type");

  const spamCheck = await assertContentGenerationAllowed(supabase, projectId, type);
  if (!spamCheck.allowed) return apiError(spamCheck.reason, 429);

  await trackApiUsage(supabase, access.organizationId, "openai", "content_generate", 5);

  let generated;
  if (repurposeFrom) {
    const { data: parent } = await supabase
      .from("content_assets")
      .select("*")
      .eq("id", repurposeFrom)
      .single();
    if (parent) {
      const { repurposeHubAsset } = await import("@/lib/engines/content-generator");
      generated = await repurposeHubAsset(
        parent.type as ContentAssetType,
        parent.title,
        parent.content || "",
        brandProfile || { brand_name: "Brand" },
        type
      );
    }
  }

  const content = generated || await generateContent(
    type,
    brandProfile || { brand_name: "Brand" },
    String(topic).slice(0, 500),
    additionalContext ? String(additionalContext).slice(0, 2000) : undefined
  );

  const { data: asset, error } = await supabase
    .from("content_assets")
    .insert({
      project_id: projectId,
      type,
      title: String(content.title).slice(0, 200),
      content: content.content,
      metadata: content.metadata || {},
      status: "drafted",
      parent_asset_id: parentAssetId || repurposeFrom || null,
    })
    .select()
    .single();

  if (error) return apiServerError("content create failed", error);

  return NextResponse.json({ asset });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { assetId, status, pipelineStep } = await readJsonBody(request) as {
    assetId: string;
    status?: string;
    pipelineStep?: BlogPipelineStepKey;
  };
  if (!assetId) return apiError("assetId required");
  if (!status && !pipelineStep) return apiError("status or pipelineStep required");
  if (status && !VALID_STATUSES.has(status)) return apiError("Invalid status");

  const { data: asset } = await supabase
    .from("content_assets")
    .select("project_id, metadata")
    .eq("id", assetId)
    .single();

  if (!asset) return apiNotFound();

  const access = await verifyProjectAccess(supabase, asset.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (pipelineStep) {
    updates.metadata = advancePipeline(
      (asset.metadata || {}) as Record<string, unknown>,
      pipelineStep
    );
  }

  const { data, error } = await supabase
    .from("content_assets")
    .update(updates)
    .eq("id", assetId)
    .select()
    .single();

  if (error) return apiServerError("content update failed", error);
  return NextResponse.json({ asset: data });
}
