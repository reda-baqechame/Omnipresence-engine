"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";

const STEPS = ["Brand Info", "Competitors", "Goals"];

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    industry: "",
    location: "",
    competitors: "",
    target_buyer: "",
    main_offer: "",
    conversion_goal: "",
    monthly_ad_spend: "",
    current_monthly_traffic: "",
    aov: "",
    ltv: "",
    scope: "national",
  });

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        competitors: form.competitors.split(",").map((c) => c.trim()).filter(Boolean),
        monthly_ad_spend: form.monthly_ad_spend ? parseFloat(form.monthly_ad_spend) : undefined,
        current_monthly_traffic: form.current_monthly_traffic ? parseInt(form.current_monthly_traffic) : undefined,
        aov: form.aov ? parseFloat(form.aov) : undefined,
        ltv: form.ltv ? parseFloat(form.ltv) : undefined,
        scope: form.scope,
      }),
    });

    if (res.ok) {
      const { project } = await res.json();
      router.push(`/app/projects/${project.id}`);
    } else {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/app" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <h1 className="text-3xl font-bold mb-2">New OmniPresence Audit</h1>
      <p className="text-muted-foreground mb-8">Tell us about the brand you want to audit.</p>

      <div className="flex gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= step ? "bg-primary" : "bg-secondary"}`} />
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        {step === 0 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Brand Name *</label>
              <input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Acme Inc." title="Brand name"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Website Domain *</label>
              <input value={form.domain} onChange={(e) => update("domain", e.target.value)} placeholder="example.com"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Industry *</label>
                <input value={form.industry} onChange={(e) => update("industry", e.target.value)} placeholder="e.g. Dental, SaaS, Legal"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Location</label>
                <input value={form.location} onChange={(e) => update("location", e.target.value)} placeholder="e.g. Montreal, QC"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Competitors (comma-separated)</label>
              <input value={form.competitors} onChange={(e) => update("competitors", e.target.value)} placeholder="Competitor A, Competitor B, Competitor C"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Target Buyer</label>
              <input value={form.target_buyer} onChange={(e) => update("target_buyer", e.target.value)} placeholder="e.g. Homeowners with urgent plumbing needs"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Main Offer</label>
              <input value={form.main_offer} onChange={(e) => update("main_offer", e.target.value)} placeholder="e.g. 24/7 emergency plumbing"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Conversion Goal</label>
              <input value={form.conversion_goal} onChange={(e) => update("conversion_goal", e.target.value)} placeholder="e.g. Book a call, Request a quote"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Monthly Ad Spend ($)</label>
                <input type="number" value={form.monthly_ad_spend} onChange={(e) => update("monthly_ad_spend", e.target.value)} placeholder="0" title="Monthly ad spend"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Monthly Traffic</label>
                <input type="number" value={form.current_monthly_traffic} onChange={(e) => update("current_monthly_traffic", e.target.value)} placeholder="0" title="Current monthly traffic"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Avg. Order Value ($)</label>
                <input type="number" value={form.aov} onChange={(e) => update("aov", e.target.value)} placeholder="e.g. 250"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Customer LTV ($)</label>
                <input type="number" value={form.ltv} onChange={(e) => update("ltv", e.target.value)} placeholder="e.g. 1200"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Market Scope</label>
                <select value={form.scope} onChange={(e) => update("scope", e.target.value)} aria-label="Market scope" title="Market scope"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="local">Local</option>
                  <option value="national">National</option>
                  <option value="global">Global</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              AOV/LTV and scope tune the 90-day operating plan and paid-ad-equivalent value — they&apos;re never used to fabricate metrics.
            </p>
          </>
        )}

        <div className="flex justify-between pt-4">
          {step > 0 ? (
            <button onClick={() => setStep(step - 1)} className="text-sm text-muted-foreground hover:text-foreground">Back</button>
          ) : <div />}
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1">
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={loading || !form.name || !form.domain}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? "Creating & Scanning..." : "Start OmniPresence Audit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
