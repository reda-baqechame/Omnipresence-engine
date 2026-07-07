import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrgContext {
  orgId: string;
  role: string;
}

type MembershipRow = { organization_id: string; role: string };

/**
 * Pure resolver — prefers preferredOrgId when the user belongs to that org,
 * otherwise falls back to the first membership (stable created_at order).
 */
export function resolveActiveOrgFromMemberships(
  memberships: MembershipRow[],
  preferredOrgId?: string | null
): OrgContext | null {
  if (!memberships.length) return null;

  if (preferredOrgId) {
    const match = memberships.find((m) => m.organization_id === preferredOrgId);
    if (match) {
      return { orgId: match.organization_id, role: match.role };
    }
  }

  const first = memberships[0];
  return { orgId: first.organization_id, role: first.role };
}

/**
 * Resolve the active organization for a session-authenticated user.
 * Prefers the `x-org-id` cookie when the user belongs to that org; otherwise
 * falls back to the user's first membership (stable created_at order).
 */
export async function getActiveOrgContext(
  supabase: SupabaseClient,
  userId: string,
  preferredOrgId?: string
): Promise<OrgContext | null> {
  const cookieStore = await cookies();
  const cookieOrgId = preferredOrgId ?? cookieStore.get("x-org-id")?.value;

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return resolveActiveOrgFromMemberships(memberships ?? [], cookieOrgId);
}
