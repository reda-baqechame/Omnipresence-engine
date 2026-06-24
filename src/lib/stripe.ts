import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeInstance = new Stripe(key, {
      apiVersion: "2026-05-27.dahlia",
      typescript: true,
    });
  }
  return stripeInstance;
}

export const PLANS = {
  audit: {
    name: "One-Time Audit",
    price: 199,
    priceId: process.env.STRIPE_PRICE_AUDIT || "price_audit",
    mode: "payment" as const,
    features: [
      "Full OmniPresence Score",
      "AI & Search Visibility Scan",
      "Technical Readiness Audit",
      "Competitor Gap Analysis",
      "90-Day Execution Roadmap",
      "White-Label PDF Report",
    ],
  },
  tracking: {
    name: "Monthly Tracking",
    price: 299,
    priceId: process.env.STRIPE_PRICE_TRACKING || "price_tracking",
    mode: "subscription" as const,
    features: [
      "Everything in Audit",
      "Monthly AI Visibility Re-scans",
      "Competitor Movement Tracking",
      "Citation & Source Tracking",
      "Historical Trend Charts",
      "Automated Weekly Reports",
      "Up to 150 tracked prompts",
    ],
  },
  agency: {
    name: "Agency White-Label",
    price: 999,
    priceId: process.env.STRIPE_PRICE_AGENCY || "price_agency",
    mode: "subscription" as const,
    features: [
      "Everything in Tracking",
      "White-Label Branding",
      "Unlimited Client Projects",
      "Up to 300 prompts per project",
      "Content Generation Tools",
      "Authority Outreach CRM",
      "Priority Support",
    ],
  },
} as const;

export type PlanKey = keyof typeof PLANS;
