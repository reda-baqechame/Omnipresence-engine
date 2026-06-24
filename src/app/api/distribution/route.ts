import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scheduleViaAyrshare } from "@/lib/providers/social/ayrshare";
import { scheduleViaBuffer } from "@/lib/providers/social/buffer";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";

// Distribution & publishing integrations (Phase 4)
const PUBLISHERS = {
  wordpress: async (url: string, apiKey: string, content: { title: string; content: string }) => {
    const response = await fetch(`${url}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: content.title, content: content.content, status: "draft" }),
    });
    return response.ok;
  },
  webflow: async (siteId: string, apiKey: string, content: { title: string; content: string }) => {
    const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/collections`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.ok;
  },
  shopify: async (shop: string, apiKey: string, content: { title: string; content: string }) => {
    const response = await fetch(`https://${shop}.myshopify.com/admin/api/2024-01/blogs.json`, {
      headers: { "X-Shopify-Access-Token": apiKey },
    });
    return response.ok;
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
    const success = await publisher(
      credentials.url || credentials.siteId || credentials.shop,
      credentials.apiKey,
      { title: asset.title, content: asset.content || "" }
    );

    if (success) {
      await supabase.from("content_assets").update({ status: "published" }).eq("id", assetId);
    }

    return NextResponse.json({ success });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Publish failed",
    }, { status: 500 });
  }
}

// Bulk indexing submission
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
  if (!indexNowKey) {
    return apiError("IndexNow not configured", 503);
  }

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

  if (engines?.includes("indexnow") && validatedUrls.length > 0) {
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

  return NextResponse.json({ results, submitted: validatedUrls.length });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { platform, credentials, text, platforms, profileIds, scheduleDate, projectId } = await request.json() as {
    platform: "ayrshare" | "buffer";
    credentials: { apiKey?: string; accessToken?: string };
    text: string;
    platforms?: string[];
    profileIds?: string[];
    scheduleDate?: string;
    projectId: string;
  };

  if (!projectId) return apiError("projectId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  if (!text?.trim()) {
    return apiError("Post text required");
  }

  if (platform === "ayrshare") {
    const apiKey = credentials.apiKey;
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
    const accessToken = credentials.accessToken;
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
