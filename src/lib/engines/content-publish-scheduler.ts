import type { SupabaseClient } from "@supabase/supabase-js";
import { submitBingUrls } from "@/lib/providers/bing-webmaster";
import { submitIndexNow } from "@/lib/engines/indexnow";
import {
  loadProjectIntegration,
  publishViaCms,
  type CmsCredentials,
  type CmsPlatform,
} from "@/lib/integrations/store";
import { recordLedgerAction } from "@/lib/engines/results-ledger";

const CMS_PLATFORMS = new Set<CmsPlatform>(["wordpress", "webflow", "shopify"]);

/**
 * Process content assets scheduled for publish. Uses stored CMS integrations when available.
 */
export async function processScheduledContent(
  supabase: SupabaseClient
): Promise<{ queued: number; indexed: number; published: number }> {
  const now = new Date().toISOString();

  const { data: assets } = await supabase
    .from("content_assets")
    .select("id, project_id, title, content, metadata, published_url")
    .eq("status", "approved")
    .limit(50);

  const due = (assets || []).filter((asset) => {
    const meta = (asset.metadata || {}) as Record<string, unknown>;
    const scheduledAt = meta.scheduled_at as string | undefined;
    return scheduledAt && scheduledAt <= now;
  }).slice(0, 20);

  if (!due.length) return { queued: 0, indexed: 0, published: 0 };

  let queued = 0;
  let indexed = 0;
  let published = 0;

  for (const asset of due) {
    const meta = (asset.metadata || {}) as Record<string, unknown>;
    const platform = ((meta.publisher_platform as string) || "wordpress") as CmsPlatform;

    const { data: project } = await supabase
      .from("projects")
      .select("domain, organization_id, name")
      .eq("id", asset.project_id)
      .single();
    if (!project) continue;

    let publishedUrl = (meta.target_url as string) || asset.published_url || undefined;

    const cmsCreds = CMS_PLATFORMS.has(platform)
      ? await loadProjectIntegration<CmsCredentials>(supabase, asset.project_id, platform)
      : null;

    if (cmsCreds && asset.content) {
      const result = await publishViaCms(platform, cmsCreds, {
        title: asset.title,
        content: asset.content,
      });
      if (result.ok) {
        publishedUrl = result.publishedUrl || publishedUrl;
        published++;
        await recordLedgerAction(supabase, {
          project_id: asset.project_id,
          action_type: "content_published",
          action_surface: platform,
          description: `Auto-published "${asset.title}"`,
          status: "completed",
          outcome_snapshot: { publishedUrl },
        });
      }
    } else {
      await supabase.from("ops_queue").insert({
        project_id: asset.project_id,
        organization_id: project.organization_id,
        action_type: "content_publish",
        title: `Publish scheduled: ${asset.title}`,
        payload: { asset_id: asset.id, scheduled_at: meta.scheduled_at, target_url: meta.target_url },
        risk_level: "low",
        status: "approved",
      });
      queued++;
    }

    if (publishedUrl) {
      indexed += await submitIndexNow([publishedUrl], project.domain);
    }

    if (process.env.BING_WEBMASTER_API_KEY && process.env.BING_SITE_URL && publishedUrl) {
      await submitBingUrls(
        process.env.BING_WEBMASTER_API_KEY,
        process.env.BING_SITE_URL,
        [publishedUrl]
      ).catch(() => {});
    }

    await supabase
      .from("content_assets")
      .update({
        status: "published",
        published_url: publishedUrl,
        metadata: { ...meta, published_at: now, scheduler: "inngest" },
      })
      .eq("id", asset.id);
  }

  return { queued, indexed, published };
}
