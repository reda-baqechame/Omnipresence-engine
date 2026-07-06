import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve an organization's id from its public audit referral token. */
export async function resolveOrgFromAuditToken(
  supabase: SupabaseClient,
  token: string | undefined | null
): Promise<string | null> {
  const t = (token || "").trim().toLowerCase();
  if (!t || t.length < 16 || t.length > 64 || !/^[a-f0-9]+$/.test(t)) {
    return null;
  }

  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("audit_referral_token", t)
    .maybeSingle();

  return data?.id ?? null;
}
