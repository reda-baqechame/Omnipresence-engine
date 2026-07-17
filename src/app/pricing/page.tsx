import Link from "next/link";
import type { Metadata } from "next";
import { Globe, Check } from "lucide-react";
import { PLAN_TIERS } from "@/lib/plans/features";
import { PricingCalculator } from "@/components/pricing-calculator";

export const metadata: Metadata = {
  title: "Pricing — PresenceOS | Three plans. Every feature. $199 cap.",
  description:
    "AI visibility tracking with verifiable receipts. Every feature on every plan — white-label reports, all engines, API & MCP. Plans differ only in capacity. From $29/mo, capped at $199.",
};

const COMPARISON = [
  {
    vendor: "PresenceOS Agency",
    price: "$199/mo",
    prompts: "300 prompts, 15 brands",
    engines: "All engines + Google surfaces included",
    receipts: "Public hash-chain receipts on every result",
    whiteLabel: "Included",
  },
  {
    vendor: "Otterly.AI Pro",
    price: "$189/mo",
    prompts: "100 prompts",
    engines: "4 engines; Gemini, AI Mode, Claude cost extra",
    receipts: "No verifiable evidence chain",
    whiteLabel: "Higher tier",
  },
  {
    vendor: "Peec AI",
    price: "$95+/mo",
    prompts: "50 prompts",
    engines: "3 selected models; more via credits",
    receipts: "No verifiable evidence chain",
    whiteLabel: "Agency tiers only",
  },
  {
    vendor: "Rankscale",
    price: "$99–$385/mo",
    prompts: "Metered responses (4,800–22,000)",
    engines: "Included, response-metered",
    receipts: "No verifiable evidence chain",
    whiteLabel: "Higher tier",
  },
  {
    vendor: "Profound",
    price: "$$$ enterprise",
    prompts: "Custom contracts",
    engines: "Included",
    receipts: "No public verification",
    whiteLabel: "Enterprise",
  },
];

const INCLUDED_EVERYWHERE = [
  "Every AI engine + Google surfaces (ChatGPT, Perplexity, Gemini, Copilot, AI Overviews, organic)",
  "Multi-run prompt panels with confidence intervals — not one-off screenshots",
  "Verifiable receipts: hash-chained evidence with public /verify pages",
  "Weekly action sprints with honest before/after verdicts",
  "Copy-paste fixes, CMS deployment, MCP for Claude/Cursor",
  "GA4 AI-referral attribution (sessions, conversions, revenue by AI source)",
  "White-label reports and client portals",
  "API access and full evidence export",
];

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-muted-foreground hover:text-foreground transition">
            Log in
          </Link>
          <Link
            href="/signup"
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition"
          >
            Start free
          </Link>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-block bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          Three plans. Every feature. Hard-capped at $199.
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-5">
          No feature paywalls.
          <br />
          <span className="text-primary">Only capacity.</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Competitors lock engines, white-label, and API behind $189–$999 tiers. Here, the $29 plan
          has every feature the $199 plan has — you pay only for how much you measure.
        </p>
      </section>

      <section className="max-w-7xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-4 gap-5">
          {PLAN_TIERS.map((tier) => {
            const isAgency = tier.id === "agency";
            return (
              <div
                key={tier.slug}
                className={`bg-card border rounded-2xl p-6 flex flex-col ${
                  isAgency ? "border-primary shadow-lg shadow-primary/10" : "border-border"
                }`}
              >
                {isAgency && (
                  <div className="text-xs font-semibold text-primary mb-2">MOST POPULAR</div>
                )}
                <h2 className="text-lg font-semibold">{tier.name}</h2>
                <div className="mt-2 mb-3">
                  <span className="text-4xl font-extrabold">${tier.monthlyPrice ?? 0}</span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{tier.positioning}</p>
                <ul className="space-y-2 text-sm flex-1">
                  {tier.highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                      <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signup"
                  className={`mt-5 text-center px-4 py-2.5 rounded-lg text-sm font-medium transition ${
                    isAgency
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "border border-border hover:bg-secondary"
                  }`}
                >
                  {tier.id === "free" ? "Start free" : `Start with ${tier.name}`}
                </Link>
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">
          An observation = one prompt × one engine × one run. That&apos;s the only meter — no
          credits, no per-engine add-ons, no seat fees.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <PricingCalculator />
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold mb-2 text-center">Included on every plan</h2>
        <p className="text-muted-foreground text-center mb-8">
          If we build it, you get it — on Free, Solo, Growth, and Agency alike.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          {INCLUDED_EVERYWHERE.map((f) => (
            <div key={f} className="flex gap-3 bg-card border border-border rounded-xl p-4">
              <Check className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <span className="text-sm">{f}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold mb-2 text-center">How $199 compares</h2>
        <p className="text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
          Published competitor pricing as of mid-2026 — check their sites for current numbers.
          The structural difference: they meter features, we meter capacity.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-card text-left">
                <th className="p-3 font-semibold">Vendor</th>
                <th className="p-3 font-semibold">Price</th>
                <th className="p-3 font-semibold">Capacity</th>
                <th className="p-3 font-semibold">Engines</th>
                <th className="p-3 font-semibold">Evidence</th>
                <th className="p-3 font-semibold">White-label</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row, i) => (
                <tr
                  key={row.vendor}
                  className={`border-t border-border ${i === 0 ? "bg-primary/5 font-medium" : ""}`}
                >
                  <td className="p-3">{row.vendor}</td>
                  <td className="p-3">{row.price}</td>
                  <td className="p-3">{row.prompts}</td>
                  <td className="p-3">{row.engines}</td>
                  <td className="p-3">{row.receipts}</td>
                  <td className="p-3">{row.whiteLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-24 text-center">
        <h2 className="text-3xl font-bold mb-4">Start with the free plan</h2>
        <p className="text-muted-foreground mb-8">
          1 brand, 5 prompts, every feature, real measurements with receipts. Upgrade only when you
          need more capacity.
        </p>
        <Link
          href="/signup"
          className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold text-lg hover:opacity-90 transition"
        >
          Create your free account
        </Link>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground space-y-2">
        <p>PresenceOS — The Organic Visibility Engine</p>
        <p className="flex justify-center gap-4">
          <Link href="/privacy" className="hover:text-foreground transition">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
