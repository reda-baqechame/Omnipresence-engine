import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/providers/http";

interface OAuthConnection {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  provider: string;
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
} | null> {
  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) return null;
  return response.json();
}

export async function getValidOAuthToken(
  supabase: SupabaseClient,
  projectId: string,
  provider: string
): Promise<string | null> {
  const { data: connection } = await supabase
    .from("oauth_connections")
    .select("*")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .single();

  if (!connection?.access_token) return null;

  const conn = connection as OAuthConnection;
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  const isExpired = expiresAt > 0 && expiresAt < Date.now() + 60_000;

  if (!isExpired || !conn.refresh_token) {
    return conn.access_token;
  }

  if (
    provider === "google_search_console" ||
    provider === "google_analytics" ||
    provider === "google_business_profile"
  ) {
    const refreshed = await refreshGoogleAccessToken(conn.refresh_token);
    if (!refreshed) return conn.access_token;

    await supabase
      .from("oauth_connections")
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token || conn.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("project_id", projectId)
      .eq("provider", provider);

    return refreshed.access_token;
  }

  return conn.access_token;
}
