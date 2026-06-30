import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signOAuthState } from "@/lib/security/oauth-state";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiUnauthorized, apiForbidden, apiServerError, readJsonBody } from "@/lib/security/api-response";

const OAUTH_PROVIDERS = {
  google_search_console: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    google: true,
    redirectPath: "attribution",
  },
  bing_webmaster: {
    authUrl: "https://www.bing.com/webmasters/oauth/authorize",
    scopes: ["webmaster.manage"],
    clientIdEnv: "BING_CLIENT_ID",
    google: false,
    redirectPath: "attribution",
  },
  google_analytics: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    google: true,
    redirectPath: "attribution",
  },
  google_business_profile: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    google: true,
    redirectPath: "distribution",
  },
  hubspot: {
    authUrl: "https://app.hubspot.com/oauth/authorize",
    scopes: ["crm.objects.contacts.read", "crm.objects.deals.read", "oauth"],
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    google: false,
    redirectPath: "attribution",
  },
  google_ads: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    google: true,
    redirectPath: "attribution",
  },
  meta_ads: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    scopes: ["ads_read"],
    clientIdEnv: "META_CLIENT_ID",
    google: false,
    redirectPath: "attribution",
  },
  linkedin_ads: {
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    scopes: ["r_ads_reporting", "r_ads"],
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    google: false,
    redirectPath: "attribution",
  },
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const projectId = searchParams.get("projectId");

  if (!provider || !projectId) {
    return apiError("Missing params");
  }

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const config = OAUTH_PROVIDERS[provider as keyof typeof OAUTH_PROVIDERS];
  if (!config) return apiError("Unknown provider");

  const clientId = process.env[config.clientIdEnv] || "";
  if (!clientId) {
    return apiServerError("OAuth client not configured");
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/callback`;
  const state = signOAuthState({ provider, projectId, userId: user.id });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
  });

  if (config.google) {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  return NextResponse.redirect(`${config.authUrl}?${params}`);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, provider, accessToken, refreshToken, expiresAt, metadata } = await readJsonBody(request);

  const access = await verifyProjectAccess(supabase, projectId, user.id, "admin");
  if (!access) return apiForbidden();

  const { data, error } = await supabase
    .from("oauth_connections")
    .upsert({
      project_id: projectId,
      provider,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      ...(metadata && typeof metadata === "object" ? { metadata } : {}),
    }, { onConflict: "project_id,provider" })
    .select()
    .single();

  if (error) return apiServerError("oauth connection failed", error);
  return NextResponse.json({ connection: data });
}
