import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateContent } from "@/lib/engines/content-generator";
import { assertContentGenerationAllowed } from "@/lib/engines/content-guardrails";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { trackApiUsage } from "@/lib/metering/api-usage";
import { apiError, apiForbidden, apiNotFound, apiServerError, apiUnauthorized } from "@/lib/security/api-response";
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

  const { projectId, type, topic, additionalContext } = await request.json() as {
    projectId: string;
    type: ContentAssetType;
    topic: string;
    additionalContext?: string;
  };

  if (!projectId || !type || !topic?.trim()) {
    return apiError("projectId, type, and topic required");
  }

  if (!VALID_TYPES.has(type)) return apiError("Invalid content type");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const spamCheck = await assertContentGenerationAllowed(supabase, projectId, type);
  if (!spamCheck.allowed) return apiError(spamCheck.reason, 429);

  await trackApiUsage(supabase, access.organizationId, "openai", "content_generate", 5);

  const { data: brandProfile } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("project_id", projectId)
    .single();

  const content = await generateContent(
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

  const { assetId, status } = await request.json();
  if (!assetId || !status) return apiError("assetId and status required");
  if (!VALID_STATUSES.has(status)) return apiError("Invalid status");

  const { data: asset } = await supabase
    .from("content_assets")
    .select("project_id")
    .eq("id", assetId)
    .single();

  if (!asset) return apiNotFound();

  const access = await verifyProjectAccess(supabase, asset.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const { data, error } = await supabase
    .from("content_assets")
    .update({ status })
    .eq("id", assetId)
    .select()
    .single();

  if (error) return apiServerError("content update failed", error);
  return NextResponse.json({ asset: data });
}
