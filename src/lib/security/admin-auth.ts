import { createClient } from "@/lib/supabase/server";

/**
 * Shared gate for platform-internal (non-tenant-scoped) surfaces — health
 * checks, benchmark/parity dashboards, ops consoles. Two ways in:
 *
 * 1. A server-to-server bearer secret (env-configured per surface, e.g.
 *    HEALTH_ADMIN_SECRET). Required for CI/uptime probes that have no user
 *    session.
 * 2. Any authenticated user holding an "owner" or "admin" membership role in
 *    at least one organization. These surfaces show platform-wide data (no
 *    per-tenant rows), so "some org owner/admin" is the bar, not "owner of a
 *    specific org" — there is no specific org to scope to.
 *
 * Extracted from the health route's original isHealthAuthorized() so new
 * internal dashboards (e.g. the OmniData-vs-paid parity view) reuse the same
 * check instead of re-implementing it.
 */
export async function isPlatformAdminAuthorized(
  request: Request,
  secretEnvVar: string
): Promise<boolean> {
  const adminSecret = process.env[secretEnvVar];
  if (adminSecret) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (bearer === adminSecret) return true;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  return Boolean(membership && ["owner", "admin"].includes(membership.role));
}
