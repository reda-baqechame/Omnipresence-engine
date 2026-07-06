import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { apiError, apiUnauthorized } from "@/lib/security/api-response";
import { FREE_ACCESS_MODE } from "@/lib/config/access";

export async function POST() {
  if (FREE_ACCESS_MODE) {
    return apiError("Billing is disabled — all features are currently free.", 410);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return apiError("Billing not configured", 503);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return apiError("Only organization owners or admins can manage billing", 403);
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", membership.organization_id)
    .single();

  if (!org?.stripe_customer_id) {
    return apiError("No billing account found. Subscribe to a plan first.", 404);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const portal = await getStripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${appUrl}/app/settings/billing`,
  });

  return NextResponse.json({ url: portal.url });
}
