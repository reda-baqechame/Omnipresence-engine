import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scheduleViaAyrshare } from "@/lib/providers/social/ayrshare";
import { scheduleViaBuffer } from "@/lib/providers/social/buffer";
import { createGBPLocalPost } from "@/lib/providers/gbp";
import { submitBingUrls } from "@/lib/providers/bing-webmaster";
import { recordLedgerAction } from "@/lib/engines/results-ledger";
import { submitIndexNow } from "@/lib/engines/indexnow";
import { loadProjectIntegration, publishViaCms, type CmsCredentials, type CmsPlatform } from "@/lib/integrations/store";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";

// Publishers are unified in @/lib/integrations/store (publishViaCms). This route
// only needs the supported-platform allowlist for request validation.
const SUPPORTED_CMS: CmsPlatform[] = ["wordpress", "webflow", "shopify", "wix", "framer", "ghost"];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { assetId, platform, credentials: inlineCredentials } = await readJsonBody(request);

  const { data: asset } = await supabase
    .from("content_assets")
    .select("*, project_id")
    .eq("id", assetId)
    .single();

  if (!asset) return apiNotFound();

  const access = await verifyProjectAccess(supabase, asset.project_id, user.id, "member");
  if (!access) return apiForbidden();

  if (!SUPPORTED_CMS.includes(platform as CmsPlatform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  let credentials = inlineCredentials as CmsCredentials | undefined;
  if (!credentials?.apiKey) {
    const stored = await loadProjectIntegration<CmsCredentials>(
      supabase,
      asset.project_id,
      platform
    );
    if (stored) credentials = stored;
  }

  if (!credentials?.apiKey) {
    return apiError("No credentials provided. Save integration in Distribution tab or pass credentials.");
  }

  try {
    const result = await publishViaCms(platform as CmsPlatform, credentials, {
      title: asset.title,
      content: asset.content || "",
    });

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

      const { data: project } = await supabase
        .from("projects")
        .select("domain")
        .eq("id", asset.project_id)
        .single();

      if (result.publishedUrl && project?.domain) {
        await submitIndexNow([result.publishedUrl], project.domain);
      }
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

  const { urls, engines, projectId } = await readJsonBody(request) as {
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

  const body = await readJsonBody(request) as {
    platform: "ayrshare" | "buffer" | "gbp";
    credentials: {
      apiKey?: string;
      accessToken?: string;
      accountId?: string;
      locationId?: string;
      gbpToken?: string;
      profileIds?: string[];
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
    let token = credentials.gbpToken || credentials.accessToken;
    let accountId = credentials.accountId;
    let locationId = credentials.locationId;

    if (!token) {
      token = (await getValidOAuthToken(supabase, projectId, "google_business_profile")) || undefined;
    }

    if ((!accountId || !locationId) && token) {
      const { data: conn } = await supabase
        .from("oauth_connections")
        .select("metadata")
        .eq("project_id", projectId)
        .eq("provider", "google_business_profile")
        .maybeSingle();
      const meta = (conn?.metadata || {}) as Record<string, string>;
      accountId = accountId || meta.account_id;
      locationId = locationId || meta.location_id;
    }

    if (!token || !accountId || !locationId) {
      return apiError("Connect GBP OAuth in Distribution tab or provide token + account/location IDs");
    }

    const result = await createGBPLocalPost(token, accountId, locationId, { summary: text });
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
    if (result.success) {
      await recordLedgerAction(supabase, {
        project_id: projectId,
        action_type: "social_scheduled",
        action_surface: "ayrshare",
        description: `Scheduled social post via Ayrshare`,
        status: "completed",
        outcome_snapshot: { platforms },
      });
    }
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  }

  if (platform === "buffer") {
    const accessToken = credentials.accessToken || process.env.BUFFER_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: "Buffer access token required" }, { status: 400 });
    }
    const ids = profileIds || credentials.profileIds || [];
    const result = await scheduleViaBuffer(accessToken, {
      text,
      profileIds: ids,
      scheduledAt: scheduleDate,
    });
    if (result.success) {
      await recordLedgerAction(supabase, {
        project_id: projectId,
        action_type: "social_scheduled",
        action_surface: "buffer",
        description: `Scheduled social post via Buffer (${ids.length} profiles)`,
        status: "completed",
        outcome_snapshot: { profileIds: ids, updateId: result.updateId },
      });
    }
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  }

  return NextResponse.json({ error: "Unknown social platform" }, { status: 400 });
}
