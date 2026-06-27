import { createHash, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Public API key management (Phase 11). Keys are shown once at creation; only a
 * SHA-256 hash is stored. Format: `omp_<prefix>_<secret>`.
 */

const KEY_PREFIX = "omp";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX}_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

export interface ApiKeyContext {
  organizationId: string;
  apiKeyId: string;
}

/**
 * Resolve an Authorization: Bearer / x-api-key header to an org context. Uses a
 * service client so the public API can authenticate without a user session.
 */
export async function authenticateApiKey(
  supabase: SupabaseClient,
  request: Request
): Promise<ApiKeyContext | null> {
  const header =
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!header.startsWith(`${KEY_PREFIX}_`)) return null;

  const hash = hashApiKey(header.trim());
  const { data } = await supabase
    .from("api_keys")
    .select("id, organization_id, revoked")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!data || data.revoked) return null;

  // Best-effort last-used timestamp.
  await supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { organizationId: data.organization_id, apiKeyId: data.id };
}
