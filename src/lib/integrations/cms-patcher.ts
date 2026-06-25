import type { CmsCredentials } from "@/lib/integrations/store";

/** Apply on-page meta fixes to WordPress when post ID or slug is known. */
export async function patchWordPressPageMeta(
  creds: CmsCredentials,
  opts: { postId?: number; slug?: string; title?: string; metaDescription?: string }
): Promise<{ ok: boolean; postId?: number }> {
  const base = (creds.url || "").replace(/\/$/, "");
  if (!base || !creds.apiKey) return { ok: false };

  let postId = opts.postId;
  if (!postId && opts.slug) {
    const search = await fetch(
      `${base}/wp-json/wp/v2/posts?slug=${encodeURIComponent(opts.slug)}&per_page=1`,
      { headers: { Authorization: `Bearer ${creds.apiKey}` } }
    );
    if (search.ok) {
      const posts = (await search.json()) as Array<{ id: number }>;
      postId = posts[0]?.id;
    }
  }
  if (!postId) return { ok: false };

  const body: Record<string, unknown> = {};
  if (opts.title) body.title = opts.title;
  if (opts.metaDescription) {
    body.meta = { _yoast_wpseo_metadesc: opts.metaDescription };
  }

  const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, postId };
}

/** Append an internal link to WordPress post content when approved. */
export async function injectInternalLinkToWordPress(
  creds: CmsCredentials,
  opts: { sourceUrl: string; targetUrl: string; anchor: string }
): Promise<{ ok: boolean }> {
  const base = (creds.url || "").replace(/\/$/, "");
  if (!base || !creds.apiKey) return { ok: false };

  let slug: string;
  try {
    slug = new URL(opts.sourceUrl).pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return { ok: false };
  }
  if (!slug) return { ok: false };

  const search = await fetch(
    `${base}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&per_page=1`,
    { headers: { Authorization: `Bearer ${creds.apiKey}` } }
  );
  if (!search.ok) return { ok: false };
  const posts = (await search.json()) as Array<{ id: number; content: { rendered?: string } }>;
  const post = posts[0];
  if (!post?.id) return { ok: false };

  const linkHtml = `<p><a href="${opts.targetUrl}">${opts.anchor}</a></p>`;
  const existing = post.content?.rendered || "";
  if (existing.includes(opts.targetUrl)) return { ok: true };

  const res = await fetch(`${base}/wp-json/wp/v2/posts/${post.id}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: `${existing}\n${linkHtml}` }),
  });
  return { ok: res.ok };
}
