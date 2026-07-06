import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, PLANS, type PlanKey } from "@/lib/stripe";
import { apiError, apiUnauthorized, validateBody } from "@/lib/security/api-response";
import { guardOrgEndpoint } from "@/lib/security/api-v1-guard";
import { FREE_ACCESS_MODE } from "@/lib/config/access";
import { BillingCheckoutSchema } from "@/lib/validation/schemas";

export async function POST(request: NextRequest) {
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

  const parsed = await validateBody(request, BillingCheckoutSchema);
  if (parsed.response) return parsed.response;
  const planKey = (parsed.data.plan as PlanKey) || "tracking";
  if (!(planKey in PLANS)) {
    return apiError("Invalid plan. Choose audit, tracking, or agency.");
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return apiError("Only organization owners or admins can manage billing", 403);
  }

  const limited = await guardOrgEndpoint(membership.organization_id, "billing-checkout", 10, 60 * 60 * 1000);
  if (limited) return limited;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, stripe_customer_id")
    .eq("id", membership.organization_id)
    .single();

  if (!org) return apiError("Organization not found", 404);

  const plan = PLANS[planKey];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const session = await getStripe().checkout.sessions.create({
    mode: plan.mode,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${appUrl}/app/settings/billing?success=1`,
    cancel_url: `${appUrl}/app/settings/billing?canceled=1`,
    customer: org.stripe_customer_id || undefined,
    customer_email: org.stripe_customer_id ? undefined : user.email || undefined,
    metadata: {
      organization_id: org.id,
      plan: planKey,
    },
    client_reference_id: org.id,
    ...(plan.mode === "subscription"
      ? {
          subscription_data: {
            metadata: { organization_id: org.id, plan: planKey },
          },
        }
      : {}),
  });

  if (!session.url) {
    return apiError("Failed to create checkout session", 500);
  }

  return NextResponse.json({ url: session.url });
}
