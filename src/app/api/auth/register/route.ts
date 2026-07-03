import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import { apiError, apiServerError, readJsonBody } from "@/lib/security/api-response";
import { guardPublicEndpoint, isValidEmail } from "@/lib/security/public-guard";

const REGISTER_LIMIT = 8;
const REGISTER_WINDOW_MS = 60 * 60_000;

/**
 * Server-side registration with confirmed email — bypasses client email-confirm gate.
 * Used by /signup when Supabase project still requires email confirmation.
 */
export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "auth-register", REGISTER_LIMIT, REGISTER_WINDOW_MS);
  if (limited) return limited;

  let body: { email?: string; password?: string; fullName?: string; orgName?: string };
  try {
    body = await readJsonBody(request);
  } catch {
    return apiError("Invalid JSON body");
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const fullName = body.fullName?.trim().slice(0, 120) || "";
  const orgName = (body.orgName?.trim() || (fullName ? `${fullName}'s Agency` : "")).slice(0, 120);

  if (!email || !password) return apiError("Email and password are required");
  if (!isValidEmail(email)) return apiError("Invalid email address");
  if (password.length < 8) return apiError("Password must be at least 8 characters");
  if (password.length > 128) return apiError("Password is too long");
  if (orgName.length < 2) return apiError("Organization name is required");

  const service = await createServiceClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, pending_org_name: orgName },
  });

  if (createError) {
    const msg = createError.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return apiError("An account with this email already exists. Try signing in.");
    }
    return apiServerError("Registration failed", createError);
  }

  const userId = created.user?.id;
  if (!userId) return apiServerError("Registration failed", new Error("no user id"));

  const slug = slugify(orgName) + "-" + Date.now().toString(36);
  const { data: org, error: orgError } = await service
    .from("organizations")
    .insert({ name: orgName, slug, api_credit_limit: 9999999 })
    .select()
    .single();

  if (orgError || !org) {
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort cleanup */
    }
    return apiServerError("Organization setup failed", orgError || new Error("no org"));
  }

  const { error: memberError } = await service.from("memberships").insert({
    organization_id: org.id,
    user_id: userId,
    role: "owner",
  });

  if (memberError) {
    try {
      await service.from("organizations").delete().eq("id", org.id);
      await service.auth.admin.deleteUser(userId);
    } catch {
      /* best-effort cleanup */
    }
    return apiServerError("Membership setup failed", memberError);
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return NextResponse.json({
      ok: true,
      needsLogin: true,
      message: "Account created. Please sign in with your email and password.",
    });
  }

  return NextResponse.json({ ok: true, needsLogin: false });
}
