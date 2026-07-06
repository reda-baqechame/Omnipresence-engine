import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { apiError, apiUnauthorized, readJsonBody } from "@/lib/security/api-response";
import { generateApiKey } from "@/lib/security/api-keys";

async function getOrgContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<{ orgId: string; role: string } | null> {
  const { data } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .single();
  if (!data?.organization_id) return null;
  return { orgId: data.organization_id, role: data.role };
}

function requireAdmin(role: string): boolean {
  return ["owner", "admin"].includes(role);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const ctx = await getOrgContext(supabase, user.id);
  if (!ctx) return apiError("No organization");

  const { data } = await supabase
    .from("api_keys")
    .select("id, name, prefix, last_used_at, revoked, created_at")
    .eq("organization_id", ctx.orgId)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const ctx = await getOrgContext(supabase, user.id);
  if (!ctx) return apiError("No organization");
  if (!requireAdmin(ctx.role)) return apiError("Only organization owners or admins can manage API keys", 403);

  const body = await readJsonBody(request).catch(() => ({}));
  const name = (body.name as string) || "API key";

  const { key, prefix, hash } = generateApiKey();
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      organization_id: ctx.orgId,
      name,
      prefix,
      key_hash: hash,
      created_by: user.id,
    })
    .select("id, name, prefix, created_at")
    .single();

  if (error) return apiError("Failed to create API key", 500);

  // The full key is returned exactly once.
  return NextResponse.json({ ...data, key });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const ctx = await getOrgContext(supabase, user.id);
  if (!ctx) return apiError("No organization");
  if (!requireAdmin(ctx.role)) return apiError("Only organization owners or admins can manage API keys", 403);

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return apiError("id required");

  await supabase
    .from("api_keys")
    .update({ revoked: true })
    .eq("id", id)
    .eq("organization_id", ctx.orgId);

  return NextResponse.json({ ok: true });
}
