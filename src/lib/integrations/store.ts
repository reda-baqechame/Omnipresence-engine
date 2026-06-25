import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredentials } from "@/lib/security/credential-vault";

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

export async function publishViaWordPress(
  creds: { url: string; apiKey: string },
  content: { title: string; content: string }
): Promise<{ ok: boolean; publishedUrl?: string }> {
  const response = await fetch(`${creds.url.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
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
