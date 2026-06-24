import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scheduleViaAyrshare } from "@/lib/providers/social/ayrshare";
import { scheduleViaBuffer } from "@/lib/providers/social/buffer";
import { createGBPLocalPost } from "@/lib/providers/gbp";
import { submitBingUrls } from "@/lib/providers/bing-webmaster";
import { recordLedgerAction } from "@/lib/engines/results-ledger";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";

const PUBLISHERS = {
  wordpress: async (
    url: string,
    apiKey: string,
    content: { title: string; content: string },
    collectionId?: string
  ) => {
    const response = await fetch(`${url.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: content.title,
        content: content.content,
        status: "publish",
      }),
    });
    if (!response.ok) return { ok: false, publishedUrl: undefined };
    const data = await response.json() as { link?: string };
    return { ok: true, publishedUrl: data.link };
  },
  webflow: async (
    siteId: string,
    apiKey: string,
    content: { title: string; content: string },
    collectionId?: string
  ) => {
    if (!collectionId) return { ok: false, publishedUrl: undefined };
    const response = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
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
    if (!response.ok) return { ok: false, publishedUrl: undefined };
    const data = await response.json() as { id?: string };
    return { ok: true, publishedUrl: `https://webflow.com/item/${data.id}` };
  },
  shopify: async (
    shop: string,
    apiKey: string,
    content: { title: string; content: string },
    collectionId?: string
  ) => {
    const blogId = collectionId || "news";
    const response = await fetch(
      `https://${shop.replace(/\.myshopify\.com$/, "")}.myshopify.com/admin/api/2024-01/blogs/${blogId}/articles.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": apiKey,
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
    if (!response.ok) return { ok: false, publishedUrl: undefined };
    const data = await response.json() as { article?: { id: number } };
    return { ok: true, publishedUrl: `shopify://article/${data.article?.id}` };
  },
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { assetId, platform, credentials } = await request.json();

  const { data: asset } = await supabase
    .from("content_assets")
    .select("*, project_id")
    .eq("id", assetId)
    .single();

  if (!asset) return apiNotFound();

  const access = await verifyProjectAccess(supabase, asset.project_id, user.id, "member");
  if (!access) return apiForbidden();

  const publisher = PUBLISHERS[platform as keyof typeof PUBLISHERS];
  if (!publisher) return NextResponse.json({ error: "Unknown platform" }, { status: 400 });

  try {
    const result = await publisher(
      credentials.url || credentials.siteId || credentials.shop,
      credentials.apiKey,
      { title: asset.title, content: asset.content || "" },
      credentials.collectionId
    );

    if (result.ok) {
      await supabase
        .from("content_assets")
        .update({
          status: "published",
          published_url: result.publishedUrl,
        })
        .eq("id", assetId);

      await recordLedgerAction(supabase, {
        project_id: asset.project_id,
        action_type: "content_published",
        action_surface: platform,
        description: `Published "${asset.title}" to ${platform}`,
        status: "completed",
        outcome_snapshot: { publishedUrl: result.publishedUrl },
      });
    }

    return NextResponse.json({ success: result.ok, publishedUrl: result.publishedUrl });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Publish failed",
    }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { urls, engines, projectId } = await request.json() as {
    urls: string[];
    engines: ("google" | "bing" | "indexnow")[];
    projectId: string;
  };

  if (!projectId || !urls?.length) {
    return apiError("projectId and urls required");
  }

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: project } = await supabase
    .from("projects")
    .select("domain")
    .eq("id", projectId)
    .single();

  if (!project) return apiNotFound();

  const indexNowKey = process.env.INDEXNOW_KEY;
  const { assertUrlBelongsToDomain } = await import("@/lib/security/domain");
  const validatedUrls: string[] = [];
  for (const url of urls.slice(0, 50)) {
    try {
      validatedUrls.push(assertUrlBelongsToDomain(url, project.domain));
    } catch {
      return apiError(`URL not allowed for domain: ${url}`);
    }
  }

  const results: Record<string, boolean> = {};

  if (engines?.includes("indexnow") && validatedUrls.length > 0 && indexNowKey) {
    try {
      const response = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: new URL(validatedUrls[0]).hostname,
          urlList: validatedUrls,
          key: indexNowKey,
        }),
      });
      results.indexnow = response.ok;
    } catch {
      results.indexnow = false;
    }
  }

  if (engines?.includes("bing")) {
    const { data: bingConn } = await supabase
      .from("oauth_connections")
      .select("access_token")
      .eq("project_id", projectId)
      .eq("provider", "bing_webmaster")
      .single();

    if (bingConn?.access_token) {
      const bing = await submitBingUrls(
        bingConn.access_token,
        `https://${project.domain}`,
        validatedUrls
      );
      results.bing = bing.success;
    }
  }

  await recordLedgerAction(supabase, {
    project_id: projectId,
    action_type: "urls_indexed",
    action_surface: "search",
    description: `Submitted ${validatedUrls.length} URLs for indexing`,
    status: "completed",
    outcome_snapshot: results,
  });

  return NextResponse.json({ results, submitted: validatedUrls.length });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const body = await request.json() as {
    platform: "ayrshare" | "buffer" | "gbp";
    credentials: {
      apiKey?: string;
      accessToken?: string;
      accountId?: string;
      locationId?: string;
      gbpToken?: string;
    };
    text: string;
    platforms?: string[];
    profileIds?: string[];
    scheduleDate?: string;
    projectId: string;
  };

  const { platform, credentials, text, platforms, profileIds, scheduleDate, projectId } = body;

  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (!text?.trim()) return apiError("Post text required");

  if (platform === "gbp") {
    const token = credentials.gbpToken || credentials.accessToken;
    if (!token || !credentials.accountId || !credentials.locationId) {
      return apiError("GBP requires gbpToken, accountId, locationId");
    }
    const result = await createGBPLocalPost(
      token,
      credentials.accountId,
      credentials.locationId,
      { summary: text }
    );
    if (result.success) {
      await recordLedgerAction(supabase, {
        project_id: projectId,
        action_type: "gbp_post",
        action_surface: "google_business",
        description: "Published Google Business Profile post",
        status: "completed",
      });
    }
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  }

  if (platform === "ayrshare") {
    const apiKey = credentials.apiKey || process.env.AYRSHARE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Ayrshare API key required" }, { status: 400 });
    }
    const result = await scheduleViaAyrshare(apiKey, {
      text,
      platforms: platforms || ["linkedin", "x"],
      scheduleDate,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  }

  if (platform === "buffer") {
    const accessToken = credentials.accessToken || process.env.BUFFER_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: "Buffer access token required" }, { status: 400 });
    }
    const result = await scheduleViaBuffer(accessToken, {
      text,
      profileIds: profileIds || [],
      scheduledAt: scheduleDate,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  }

  return NextResponse.json({ error: "Unknown social platform" }, { status: 400 });
}
