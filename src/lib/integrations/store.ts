import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/providers/http";
import { decryptCredentials } from "@/lib/security/credential-vault";

export type CmsPlatform = "wordpress" | "webflow" | "shopify" | "wix" | "framer" | "ghost";

export interface CmsCredentials extends Record<string, unknown> {
  url?: string;
  siteId?: string;
  shop?: string;
  apiKey: string;
  collectionId?: string;
  /** Ghost Admin API base (e.g. https://blog.example.com) + Admin token. */
  ghostUrl?: string;
  /** Framer publish webhook URL (Framer has no public CMS write API). */
  webhookUrl?: string;
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
    case "wix": {
      // Wix Blog Draft Posts API — requires a site API key + the site id.
      if (!creds.siteId) return { ok: false };
      const response = await fetchWithTimeout("https://www.wixapis.com/blog/v3/draft-posts", {
        method: "POST",
        headers: {
          Authorization: creds.apiKey,
          "Content-Type": "application/json",
          "wix-site-id": creds.siteId,
        },
        body: JSON.stringify({ draftPost: { title: content.title, richContent: { nodes: [{ type: "PARAGRAPH", paragraphData: {}, nodes: [{ type: "TEXT", textData: { text: content.content } }] }] } } }),
      });
      if (!response.ok) return { ok: false };
      const data = (await response.json()) as { draftPost?: { id?: string } };
      return { ok: true, publishedUrl: data.draftPost?.id ? `https://manage.wix.com/blog/${creds.siteId}/post/${data.draftPost.id}` : undefined };
    }
    case "ghost": {
      // Ghost Admin API uses a short-lived JWT signed (HS256) from the
      // {id}:{secret} admin key. Built with Node crypto to avoid a JWT dependency.
      const base = (creds.ghostUrl || creds.url || "").replace(/\/$/, "");
      const [keyId, secret] = (creds.apiKey || "").split(":");
      if (!base || !keyId || !secret) return { ok: false };
      try {
        const crypto = await import("node:crypto");
        const b64url = (buf: Buffer) =>
          buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const now = Math.floor(Date.now() / 1000);
        const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT", kid: keyId })));
        const payload = b64url(Buffer.from(JSON.stringify({ iat: now, exp: now + 300, aud: "/admin/" })));
        const sig = b64url(crypto.createHmac("sha256", Buffer.from(secret, "hex")).update(`${header}.${payload}`).digest());
        const token = `${header}.${payload}.${sig}`;
        const response = await fetchWithTimeout(`${base}/ghost/api/admin/posts/?source=html`, {
          method: "POST",
          headers: { Authorization: `Ghost ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ posts: [{ title: content.title, html: content.content, status: "published" }] }),
        });
        if (!response.ok) return { ok: false };
        const data = (await response.json()) as { posts?: Array<{ url?: string }> };
        return { ok: true, publishedUrl: data.posts?.[0]?.url };
      } catch {
        return { ok: false };
      }
    }
    case "framer": {
      // Framer has no public CMS write API; publish via a user-configured
      // webhook (e.g. a Make/Zapier/Framer plugin endpoint) that creates the page.
      if (!creds.webhookUrl) return { ok: false };
      const response = await fetchWithTimeout(creds.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {}) },
        body: JSON.stringify({ title: content.title, content: content.content }),
      });
      if (!response.ok) return { ok: false };
      const data = (await response.json().catch(() => ({}))) as { url?: string };
      return { ok: true, publishedUrl: data.url };
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
