"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";

const STEPS = ["Your domain", "Your brand", "Create project"];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [domain, setDomain] = useState("");
  const [brand, setBrand] = useState("");

  const canAdvance = step === 0 ? domain.trim().length > 0 : step === 1 ? brand.trim().length > 0 : true;

  const createHref = `/app/projects/new?domain=${encodeURIComponent(domain.trim())}&name=${encodeURIComponent(brand.trim())}`;

  return (
    <div className="max-w-xl mx-auto">
      <Link
        href="/app"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <h1 className="text-3xl font-bold mb-2">Welcome to PresenceOS</h1>
      <p className="text-muted-foreground mb-8">
        Three quick steps to stand up your first OmniPresence measurement.
      </p>

      <div className="flex gap-2 mb-6">
        {STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div className={`h-1 rounded-full ${i <= step ? "bg-primary" : "bg-secondary"}`} />
            <p className="mt-2 text-xs text-muted-foreground truncate">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        {step === 0 && (
          <>
            <label className="block text-sm font-medium" htmlFor="onboard-domain">
              Primary domain
            </label>
            <input
              id="onboard-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll crawl and measure AI visibility, search performance, and technical health for this domain.
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <label className="block text-sm font-medium" htmlFor="onboard-brand">
              Brand name
            </label>
            <input
              id="onboard-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Acme Inc."
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Used in AI prompt probes, entity checks, and client-facing reports for {domain || "your domain"}.
            </p>
          </>
        )}

        {step === 2 && (
          <div className="text-center py-4 space-y-4">
            <Rocket className="h-10 w-10 mx-auto text-primary" aria-hidden />
            <div>
              <p className="font-medium">Ready to measure {brand || "your brand"}</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a project for <strong>{domain || "your domain"}</strong> and kick off the first scan.
              </p>
            </div>
            <Link
              href={createHref}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition"
            >
              Create project & scan <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {step < 2 && (
          <div className="flex justify-between pt-2">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
            ) : (
              <div />
            )}
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canAdvance}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 disabled:opacity-50"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
