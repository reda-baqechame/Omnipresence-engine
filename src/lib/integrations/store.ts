import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/providers/http";
import { decryptCredentials } from "@/lib/security/credential-vault";

export type CmsPlatform = "wordpress" | "webflow" | "shopify";

export interface CmsCredentials extends Record<string, unknown> {
  url?: string;
  siteId?: string;
  shop?: string;
  apiKey: string;
  collectionId?: string;
}

export async function loadProjectIntegration<T extends Record<string, unknown>>(
  supabase: SupabaseClient,
  projectId: string,
  provider: string
): Promise<T | null> {
  const { data } = await supabase
    .from("project_integrations")
    .select("credentials_encrypted")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .eq("is_active", true)
    .maybeSingle();

  if (!data?.credentials_encrypted) return null;
  try {
    return decryptCredentials<T>(data.credentials_encrypted);
  } catch {
    return null;
  }
}

export async function publishViaCms(
  platform: CmsPlatform,
  creds: CmsCredentials,
  content: { title: string; content: string }
): Promise<{ ok: boolean; publishedUrl?: string }> {
  switch (platform) {
    case "wordpress": {
      const url = creds.url || "";
      if (!url) return { ok: false };
      const response = await fetchWithTimeout(`${url.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: content.title,
          content: content.content,
          status: "publish",
        }),
      });
      if (!response.ok) return { ok: false };
      const data = (await response.json()) as { link?: string };
      return { ok: true, publishedUrl: data.link };
    }
    case "webflow": {
      if (!creds.collectionId) return { ok: false };
      const response = await fetchWithTimeout(
        `https://api.webflow.com/v2/collections/${creds.collectionId}/items`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fieldData: {
              name: content.title,
              slug: content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
              "post-body": content.content,
            },
            isDraft: false,
          }),
        }
      );
      if (!response.ok) return { ok: false };
      const data = (await response.json()) as { id?: string };
      return { ok: true, publishedUrl: `https://webflow.com/item/${data.id}` };
    }
    case "shopify": {
      const shop = (creds.shop || creds.url || "").replace(/\.myshopify\.com$/, "");
      if (!shop) return { ok: false };
      const blogId = creds.collectionId || "news";
      const response = await fetchWithTimeout(
        `https://${shop}.myshopify.com/admin/api/2024-01/blogs/${blogId}/articles.json`,
        {
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": creds.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            article: {
              title: content.title,
              body_html: content.content,
              published: true,
            },
          }),
        }
      );
      if (!response.ok) return { ok: false };
      const data = (await response.json()) as { article?: { id: number } };
      return { ok: true, publishedUrl: `https://${shop}.myshopify.com/admin/articles/${data.article?.id}` };
    }
    default:
      return { ok: false };
  }
}

/** @deprecated Use publishViaCms */
export async function publishViaWordPress(
  creds: { url: string; apiKey: string },
  content: { title: string; content: string }
): Promise<{ ok: boolean; publishedUrl?: string }> {
  return publishViaCms("wordpress", creds, content);
}
