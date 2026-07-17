import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import type { SubscriptionPlan } from "@/types/database";

const ALLOWED_PLANS = new Set<SubscriptionPlan>(["solo", "growth", "agency"]);

// api_credit_limit mirrors the plan's monthly observation budget (limits.ts).
const PLAN_CREDIT_LIMITS: Record<SubscriptionPlan, number> = {
  free: 200,
  solo: 1500,
  growth: 5000,
  agency: 12000,
};

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("provider", "stripe")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orgId = session.metadata?.organization_id;
    const plan = session.metadata?.plan as SubscriptionPlan | undefined;

    if (session.payment_status && session.payment_status !== "paid" && session.mode === "payment") {
      await supabase.from("webhook_events").insert({
        provider: "stripe",
        event_id: event.id,
        event_type: event.type,
      });
      return NextResponse.json({ received: true, skipped: "unpaid" });
    }

    if (orgId && plan && ALLOWED_PLANS.has(plan)) {
      await supabase.from("organizations").update({
        plan,
        api_credit_limit: PLAN_CREDIT_LIMITS[plan],
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
      }).eq("id", orgId);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    await supabase.from("organizations").update({
      plan: "free",
      api_credit_limit: PLAN_CREDIT_LIMITS.free,
      stripe_subscription_id: null,
    }).eq("stripe_subscription_id", subscription.id);
  }

  await supabase.from("webhook_events").insert({
    provider: "stripe",
    event_id: event.id,
    event_type: event.type,
  });

  return NextResponse.json({ received: true });
}
