import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import { apiError, apiServerError, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { guardPublicEndpoint } from "@/lib/security/public-guard";

export async function POST(request: NextRequest) {
  const limited = await guardPublicEndpoint(request, "auth-setup-org", 20, 60 * 60_000);
  if (limited) return limited;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  let orgName: unknown;
  try {
    ({ orgName } = await readJsonBody(request));
  } catch {
    return apiError("Invalid JSON body");
  }
  if (!orgName || typeof orgName !== "string" || orgName.trim().length < 2) {
    return apiError("Organization name is required");
  }

  const service = await createServiceClient();

  const { data: existing } = await service
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (existing && existing.length > 0) {
    return apiError("Organization already exists for this user");
  }

  const slug = slugify(orgName) + "-" + Date.now().toString(36);

  const { data: org, error: orgError } = await service
    .from("organizations")
    .insert({ name: orgName.trim().slice(0, 120), slug, api_credit_limit: 9999999 })
    .select()
    .single();

  if (orgError) return apiServerError("setup-org insert failed", orgError);

  const { error: memberError } = await service
    .from("memberships")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });

  if (memberError) {
    try {
      await service.from("organizations").delete().eq("id", org.id);
    } catch {
      /* best-effort cleanup */
    }
    return apiServerError("setup-org membership failed", memberError);
  }

  return NextResponse.json({ organization: org });
}
