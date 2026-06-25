import type { SupabaseClient } from "@supabase/supabase-js";
import { submitBingUrls } from "@/lib/providers/bing-webmaster";

/**
 * Process content assets scheduled for publish. Auto-indexes URLs; queues CMS publish when no creds stored.
 */
export async function processScheduledContent(
  supabase: SupabaseClient
): Promise<{ queued: number; indexed: number }> {
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

  if (!due.length) return { queued: 0, indexed: 0 };

  let queued = 0;
  let indexed = 0;

  for (const asset of due) {
    const meta = (asset.metadata || {}) as Record<string, unknown>;
    const scheduledAt = meta.scheduled_at as string | undefined;
    if (!scheduledAt || scheduledAt > now) continue;

    const { data: project } = await supabase
      .from("projects")
      .select("domain, organization_id, name")
      .eq("id", asset.project_id)
      .single();
    if (!project) continue;

    await supabase.from("ops_queue").insert({
      project_id: asset.project_id,
      organization_id: project.organization_id,
      action_type: "content_publish",
      title: `Publish scheduled: ${asset.title}`,
      payload: {
        asset_id: asset.id,
        scheduled_at: scheduledAt,
        target_url: meta.target_url,
      },
      risk_level: "low",
      status: "approved",
    });
    queued++;

    const targetUrl = (meta.target_url as string) || asset.published_url;
    if (targetUrl && process.env.INDEXNOW_KEY) {
      try {
        const { assertUrlBelongsToDomain } = await import("@/lib/security/domain");
        assertUrlBelongsToDomain(targetUrl, project.domain);
        await fetch("https://api.indexnow.org/indexnow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: new URL(targetUrl).hostname,
            key: process.env.INDEXNOW_KEY,
            urlList: [targetUrl],
          }),
        });
        indexed++;
      } catch {
        // skip invalid URL
      }
    }

    if (process.env.BING_WEBMASTER_API_KEY && process.env.BING_SITE_URL) {
      const url = (meta.target_url as string) || `https://${project.domain}`;
      await submitBingUrls(
        process.env.BING_WEBMASTER_API_KEY,
        process.env.BING_SITE_URL,
        [url]
      ).catch(() => {});
    }

    await supabase
      .from("content_assets")
      .update({
        status: "published",
        metadata: { ...meta, published_at: now, scheduler: "inngest" },
      })
      .eq("id", asset.id);
  }

  return { queued, indexed };
}
