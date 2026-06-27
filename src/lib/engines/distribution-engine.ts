import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandProfile, ContentAssetType } from "@/types/database";
import { repurposeHubAsset } from "@/lib/engines/content-generator";

/**
 * Phase 18: Distribution & publishing engine.
 *
 * Two capabilities:
 *  - Content repurposing: turn ONE strong asset into platform-native spokes
 *    (LinkedIn, X thread, YouTube script, Reddit/Quora drafts, newsletter) and
 *    store them as tracked drafts linked to the parent.
 *  - Lifecycle tracking: every asset×destination has a stage we can advance and
 *    audit (drafted -> ... -> needs_refresh) so an agency can prove the pipeline.
 */

export const LIFECYCLE_STAGES = [
  "drafted",
  "approved",
  "scheduled",
  "published",
  "indexed",
  "ranking",
  "cited",
  "getting_leads",
  "needs_refresh",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** Repurpose targets and the channel they map to. */
export const REPURPOSE_TARGETS: Array<{ type: ContentAssetType; destination: string; label: string }> = [
  { type: "linkedin_post", destination: "linkedin", label: "LinkedIn post" },
  { type: "x_thread", destination: "x", label: "X thread" },
  { type: "youtube_script", destination: "youtube", label: "YouTube script + chapters" },
  { type: "reddit_draft", destination: "reddit", label: "Reddit draft" },
  { type: "quora_draft", destination: "quora", label: "Quora answer" },
  { type: "newsletter", destination: "newsletter", label: "Newsletter" },
];

export interface RepurposeResult {
  type: ContentAssetType;
  destination: string;
  title: string;
  assetId?: string;
}

/**
 * Repurpose a parent asset into the requested spoke formats, persist each as a
 * drafted content_asset (linked via parent_asset_id) and open a distribution_job
 * so the lifecycle is tracked from the first draft.
 */
export async function repurposeAndStore(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    parentAssetId: string;
    parentType: ContentAssetType;
    parentTitle: string;
    parentContent: string;
    brand: Partial<BrandProfile>;
    targets: ContentAssetType[];
  }
): Promise<RepurposeResult[]> {
  const results: RepurposeResult[] = [];

  for (const type of opts.targets) {
    const target = REPURPOSE_TARGETS.find((t) => t.type === type);
    if (!target) continue;

    const generated = await repurposeHubAsset(
      opts.parentType,
      opts.parentTitle,
      opts.parentContent,
      opts.brand,
      type
    );

    const { data: asset } = await supabase
      .from("content_assets")
      .insert({
        project_id: opts.projectId,
        title: generated.title,
        type,
        content: generated.content,
        status: "drafted",
        parent_asset_id: opts.parentAssetId,
        metadata: { ...(generated.metadata || {}), repurposed_from: opts.parentAssetId, destination: target.destination },
      })
      .select("id")
      .single();

    if (asset?.id) {
      await supabase.from("distribution_jobs").insert({
        project_id: opts.projectId,
        asset_id: asset.id,
        destination: target.destination,
        stage: "drafted",
        stage_history: [{ stage: "drafted", at: new Date().toISOString() }],
      });
    }

    results.push({ type, destination: target.destination, title: generated.title, assetId: asset?.id });
  }

  return results;
}

/** Advance a distribution job to a new lifecycle stage, appending to history. */
export async function advanceStage(
  supabase: SupabaseClient,
  jobId: string,
  stage: LifecycleStage,
  extra: { published_url?: string; external_id?: string; scheduled_at?: string } = {}
): Promise<void> {
  const { data: job } = await supabase
    .from("distribution_jobs")
    .select("stage_history")
    .eq("id", jobId)
    .single();

  const history = Array.isArray(job?.stage_history) ? job.stage_history : [];
  history.push({ stage, at: new Date().toISOString() });

  await supabase
    .from("distribution_jobs")
    .update({ stage, stage_history: history, ...extra })
    .eq("id", jobId);
}
