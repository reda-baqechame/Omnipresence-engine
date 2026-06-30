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
import {
  postDirectSocial,
  hasXCapability,
  hasLinkedInCapability,
  type DirectSocialPlatform,
} from "@/lib/providers/social/direct";

const CMS_PLATFORMS = new Set<CmsPlatform>(["wordpress", "webflow", "shopify", "wix", "framer", "ghost"]);

/** Map a stored destination/platform label to a native social platform. */
function socialPlatformFor(destination: string): DirectSocialPlatform | null {
  const d = destination.toLowerCase();
  if (d === "x" || d === "twitter") return "x";
  if (d === "linkedin") return "linkedin";
  return null;
}

/** Platform-safe text: X caps at 280 chars; LinkedIn comfortably under its limit. */
function socialText(raw: string, platform: DirectSocialPlatform): string {
  const text = (raw || "").trim();
  const max = platform === "x" ? 280 : 2900;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function socialPostUrl(platform: DirectSocialPlatform, postId?: string): string | undefined {
  if (!postId) return undefined;
  return platform === "x"
    ? `https://x.com/i/web/status/${postId}`
    : `https://www.linkedin.com/feed/update/${postId}`;
}

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

    // Direct social channel: post natively to X/LinkedIn. The status="approved"
    // filter above IS the human-approval gate — nothing posts until a human moves
    // the asset to approved and sets scheduled_at. We never fabricate a post.
    const socialPlatform = socialPlatformFor((meta.destination as string) || "");
    if (socialPlatform) {
      const enabled = socialPlatform === "x" ? hasXCapability() : hasLinkedInCapability();
      if (!enabled) {
        await supabase.from("ops_queue").insert({
          project_id: asset.project_id,
          organization_id: project.organization_id,
          action_type: "social_post",
          title: `Post manually to ${socialPlatform}: ${asset.title}`,
          payload: { asset_id: asset.id, platform: socialPlatform, scheduled_at: meta.scheduled_at },
          risk_level: "medium",
          status: "approved",
        });
        queued++;
      } else {
        const result = await postDirectSocial(
          socialPlatform,
          socialText(asset.content || asset.title || "", socialPlatform)
        );
        await recordLedgerAction(supabase, {
          project_id: asset.project_id,
          action_type: "content_published",
          action_surface: socialPlatform,
          description: result.success
            ? `Auto-posted "${asset.title}" to ${socialPlatform}`
            : `Failed to post "${asset.title}" to ${socialPlatform}: ${result.error}`,
          status: result.success ? "completed" : "failed",
          outcome_snapshot: { postId: result.postId, error: result.error },
        });
        if (!result.success) {
          // Leave as approved so the next cron tick retries (e.g. token refresh).
          continue;
        }
        published++;
        publishedUrl = socialPostUrl(socialPlatform, result.postId) || publishedUrl;
      }

      await supabase
        .from("content_assets")
        .update({
          status: "published",
          published_url: publishedUrl,
          metadata: { ...meta, published_at: now, scheduler: "inngest", channel: socialPlatform },
        })
        .eq("id", asset.id);
      continue;
    }

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
