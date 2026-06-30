import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { discoverGa4Property } from "@/lib/engines/attribution";
import { discoverGbpAccountLocation } from "@/lib/providers/gbp-discovery";
import { verifyOAuthState } from "@/lib/security/oauth-state";
import { verifyProjectAccess } from "@/lib/security/project-access";

async function exchangeGoogleToken(code: string, redirectUri: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) return null;

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function exchangeBingToken(code: string, redirectUri: string) {
  const response = await fetch("https://www.bing.com/webmasters/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.BING_CLIENT_ID || "",
      client_secret: process.env.BING_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) return null;

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function exchangeHubspotToken(code: string, redirectUri: string) {
  const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.HUBSPOT_CLIENT_ID || "",
      client_secret: process.env.HUBSPOT_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) return null;

  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function exchangeMetaToken(code: string, redirectUri: string) {
  const params = new URLSearchParams({
    code,
    client_id: process.env.META_CLIENT_ID || "",
    client_secret: process.env.META_CLIENT_SECRET || "",
    redirect_uri: redirectUri,
  });
  const response = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token: string; expires_in?: number };
  return {
    access_token: data.access_token,
    expires_in: data.expires_in ?? 60 * 24 * 3600,
    refresh_token: undefined as string | undefined,
  };
}

async function exchangeLinkedInToken(code: string, redirectUri: string) {
  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) return null;
  return (await response.json()) as { access_token: string; expires_in: number; refresh_token?: string };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/app?error=oauth_failed`);
  }

  const payload = verifyOAuthState(state);
  if (!payload) {
    return NextResponse.redirect(`${appUrl}/app?error=invalid_state`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== payload.userId) {
    return NextResponse.redirect(`${appUrl}/login?error=oauth_session`);
  }

  const access = await verifyProjectAccess(supabase, payload.projectId, user.id, "member");
  if (!access) {
    return NextResponse.redirect(`${appUrl}/app?error=oauth_forbidden`);
  }

  const redirectUri = `${appUrl}/api/oauth/callback`;
  const tokens =
    payload.provider === "bing_webmaster"
      ? await exchangeBingToken(code, redirectUri)
      : payload.provider === "hubspot"
        ? await exchangeHubspotToken(code, redirectUri)
        : payload.provider === "meta_ads"
          ? await exchangeMetaToken(code, redirectUri)
          : payload.provider === "linkedin_ads"
            ? await exchangeLinkedInToken(code, redirectUri)
            : await exchangeGoogleToken(code, redirectUri);

  if (!tokens) {
    const failPath =
      payload.provider === "google_business_profile" ? "distribution" : "attribution";
    return NextResponse.redirect(
      `${appUrl}/app/projects/${payload.projectId}/${failPath}?error=token_failed`
    );
  }

  const service = await createServiceClient();

  let metadata: Record<string, string> = {};
  if (payload.provider === "google_analytics") {
    const { data: project } = await service
      .from("projects")
      .select("domain")
      .eq("id", payload.projectId)
      .single();

    const propertyId = await discoverGa4Property(tokens.access_token, project?.domain || "");
    if (propertyId) metadata = { property_id: propertyId };
  }

  if (payload.provider === "google_business_profile") {
    const gbp = await discoverGbpAccountLocation(tokens.access_token);
    if (gbp.accountId) metadata.account_id = gbp.accountId;
    if (gbp.locationId) metadata.location_id = gbp.locationId;
    if (gbp.locationName) metadata.location_name = gbp.locationName;
  }

  await service.from("oauth_connections").upsert(
    {
      project_id: payload.projectId,
      provider: payload.provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      metadata,
    },
    { onConflict: "project_id,provider" }
  );

  const redirectTab =
    payload.provider === "google_business_profile" ? "distribution" : "attribution";

  return NextResponse.redirect(
    `${appUrl}/app/projects/${payload.projectId}/${redirectTab}?connected=true`
  );
}
