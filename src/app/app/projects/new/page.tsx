"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";

const STEPS = ["Brand", "Competitors"];

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    industry: "",
    competitors: "",
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
        name: form.name,
        domain: form.domain,
        industry: form.industry,
        competitors: form.competitors.split(",").map((c) => c.trim()).filter(Boolean),
      }),
    });

    if (res.ok) {
      const { project } = await res.json();
      router.push(`/app/projects/${project.id}?scan=start`);
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
      <p className="text-muted-foreground mb-8">
        Start with the minimum needed for a real measurement — like an Otterly GEO audit. Your first scan measures AI visibility across ChatGPT, Gemini, Claude, and search.
      </p>

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
            <div>
              <label className="block text-sm font-medium mb-1.5">Industry *</label>
              <input value={form.industry} onChange={(e) => update("industry", e.target.value)} placeholder="e.g. Skincare, B2B SaaS, Dental"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Competitors (comma-separated)</label>
              <input value={form.competitors} onChange={(e) => update("competitors", e.target.value)} placeholder="Competitor A, Competitor B, Competitor C"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
              <p className="mt-2 text-xs text-muted-foreground">
                Optional, but recommended. Competitors help the audit identify real share-of-voice and backlink/source gaps.
              </p>
            </div>
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
            <button onClick={handleSubmit} disabled={loading || !form.name || !form.domain || !form.industry}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? "Creating & Scanning..." : "Start OmniPresence Audit"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
