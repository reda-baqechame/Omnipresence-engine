import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

/**
 * Supabase email confirmation + magic-link callback.
 * Add to Supabase → Authentication → URL configuration:
 *   Site URL: https://omnipresence-engine.vercel.app
 *   Redirect URLs: https://omnipresence-engine.vercel.app/auth/callback
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth_callback", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_callback", origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const meta = user.user_metadata as { pending_org_name?: string; full_name?: string };
    const orgName =
      meta.pending_org_name?.trim() ||
      (meta.full_name ? `${meta.full_name}'s Agency` : "");

    if (orgName.length >= 2) {
      const service = await createServiceClient();
      const { data: existing } = await service
        .from("memberships")
        .select("id")
        .eq("user_id", user.id)
        .limit(1);

      if (!existing?.length) {
        const slug = slugify(orgName) + "-" + Date.now().toString(36);
        const { data: org, error: orgError } = await service
          .from("organizations")
          .insert({ name: orgName.slice(0, 120), slug, api_credit_limit: 9999999 })
          .select()
          .single();

        if (!orgError && org) {
          await service.from("memberships").insert({
            organization_id: org.id,
            user_id: user.id,
            role: "owner",
          });
        }
      }
    }
  }

  return NextResponse.redirect(new URL(next, origin));
}
