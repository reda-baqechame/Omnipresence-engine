"use client";

import { useEffect, useState } from "react";
import { FREE_ACCESS_MODE } from "@/lib/config/access";
import { PLAN_TIERS } from "@/lib/plans/features";

export default function BillingPage() {
  const [loading, setLoading] = useState<string | null>(null);

  async function checkout(plan: string) {
    setLoading(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || "Checkout unavailable");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || "Billing portal unavailable");
    } finally {
      setLoading(null);
    }
  }

  if (FREE_ACCESS_MODE) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Account</h1>
        <p className="text-muted-foreground mb-8">
          PresenceOS is in <strong>proof-led launch mode</strong> — all features unlocked while we onboard
          agency partners. Billing routes are wired; flip <code>FREE_ACCESS_MODE=false</code> to enable paid tiers.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {PLAN_TIERS.map((tier) => (
            <div key={tier.slug} className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-lg font-semibold">{tier.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">{tier.positioning}</p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                {tier.highlights.map((h) => (
                  <li key={h}>✓ {h}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Billing</h1>
        <p className="text-muted-foreground">
          Proof-led organic growth intelligence for agencies and AI-era search teams — not another keyword toy.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PLAN_TIERS.filter((t) => t.id !== "free").map((tier) => (
          <div key={tier.slug} className="bg-card border border-border rounded-xl p-5 flex flex-col">
            <h2 className="text-lg font-semibold">{tier.name}</h2>
            {tier.monthlyPrice && (
              <p className="text-2xl font-bold mt-2">
                ${tier.monthlyPrice}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-2 flex-1">{tier.positioning}</p>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {tier.highlights.map((h) => (
                <li key={h}>✓ {h}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => checkout(tier.id === "tracking" ? "tracking" : "agency")}
              disabled={loading === tier.id || tier.id === "enterprise"}
              className="mt-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {tier.id === "enterprise"
                ? "Contact sales"
                : loading === tier.id
                  ? "Redirecting…"
                  : `Subscribe — ${tier.name}`}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={openPortal}
        disabled={loading === "portal"}
        className="border border-border px-4 py-2 rounded-lg text-sm hover:bg-secondary"
      >
        Manage subscription
      </button>
    </div>
  );
}
