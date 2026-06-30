"use client";

import { useState } from "react";
import Link from "next/link";
import { Globe, ArrowRight, CheckCircle } from "lucide-react";
import { ScoreGauge } from "@/components/score-gauge";
import { SubScoreBar } from "@/components/score-gauge";
import { CoverageMap } from "@/components/coverage-map";

export default function PublicAuditPage() {
  const [form, setForm] = useState({ domain: "", brandName: "", industry: "", email: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    score: {
      omnipresence: number;
      ai_visibility: number;
      search_visibility: number;
      technical_readiness: number;
      availability?: { ai_visibility: boolean; search_visibility: boolean; technical_readiness: boolean };
    };
    criticalIssues: number;
    topIssues: Array<{ title: string; description: string; severity: string; fix_recommendation?: string }>;
    coverageItems?: Array<{ platform_name: string; is_present: boolean; competitor_present: boolean; surface: string }>;
    competitorGaps?: number;
    authorityOpportunities?: Array<{ target_site: string; pitch_angle: string }>;
    authority?: { rating: number; referringDomains: number; domainAgeYears: number; sources: string[] } | null;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/public/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Free OmniPresence Audit</h1>
        <p className="text-muted-foreground mb-8">
          See how visible your brand is across Google, AI search, and technical readiness — in under 60 seconds.
        </p>

        {!result ? (
          <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Website Domain *</label>
              <input
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="yourcompany.com"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Brand Name</label>
                <input
                  value={form.brandName}
                  onChange={(e) => setForm({ ...form, brandName: e.target.value })}
                  placeholder="Acme Inc."
                  title="Brand name"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Industry</label>
                <input
                  value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  placeholder="e.g. Dental, SaaS"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@company.com"
                title="Email address"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? "Scanning..." : <>Run Free Audit <ArrowRight className="h-4 w-4" /></>}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <ScoreGauge score={result.score.omnipresence} label="OmniPresence Score" size="lg" />
              <div className="mt-6 space-y-2 text-left max-w-sm mx-auto">
                <SubScoreBar label="AI Visibility" score={result.score.ai_visibility} available={result.score.availability?.ai_visibility ?? true} />
                <SubScoreBar label="Search Visibility" score={result.score.search_visibility} available={result.score.availability?.search_visibility ?? true} />
                <SubScoreBar label="Technical Readiness" score={result.score.technical_readiness} available={result.score.availability?.technical_readiness ?? true} />
              </div>
            </div>

            {result.authority && (
              <div className="bg-card border border-border rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Domain Authority</h2>
                  <span className="text-2xl font-bold text-primary">{result.authority.rating}<span className="text-sm text-muted-foreground">/100</span></span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Free-signal blend (Tranco popularity, Common Crawl referring domains, domain age). High-authority domains are far more likely to be cited by AI engines.
                </p>
                <div className="flex flex-wrap gap-3 mt-3 text-xs text-muted-foreground">
                  {result.authority.referringDomains > 0 && (
                    <span className="bg-background border border-border rounded-full px-2.5 py-1">{result.authority.referringDomains} referring domains</span>
                  )}
                  {result.authority.domainAgeYears > 0 && (
                    <span className="bg-background border border-border rounded-full px-2.5 py-1">{result.authority.domainAgeYears}y domain age</span>
                  )}
                  {result.authority.sources.map((s) => (
                    <span key={s} className="bg-background border border-border rounded-full px-2.5 py-1">{s.replace(/_/g, " ")}</span>
                  ))}
                </div>
              </div>
            )}

            {result.criticalIssues > 0 && (
              <div>
                <h2 className="font-semibold mb-3">{result.criticalIssues} critical issues found</h2>
                <div className="space-y-2">
                  {result.topIssues.map((issue, i) => (
                    <div key={i} className="bg-card border border-border rounded-lg p-4 text-sm">
                      <div className="font-medium">{issue.title}</div>
                      <p className="text-muted-foreground mt-1">{issue.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.coverageItems && result.coverageItems.length > 0 && (
              <div>
                <h2 className="font-semibold mb-3">Platform coverage</h2>
                {result.competitorGaps ? (
                  <p className="text-sm text-muted-foreground mb-3">
                    Competitors are present on {result.competitorGaps} platforms where you are missing.
                  </p>
                ) : null}
                <CoverageMap
                  items={result.coverageItems.map((c, i) => ({
                    id: `pub-${i}`,
                    project_id: "public",
                    platform_name: c.platform_name,
                    surface: c.surface as import("@/types/database").CoverageSurface,
                    is_present: c.is_present,
                    competitor_present: c.competitor_present,
                    is_optimized: false,
                    profile_url: undefined,
                    created_at: "",
                    updated_at: "",
                  }))}
                />
              </div>
            )}

            {result.authorityOpportunities && result.authorityOpportunities.length > 0 && (
              <div>
                <h2 className="font-semibold mb-3">Top authority gaps</h2>
                <ul className="space-y-2 text-sm">
                  {result.authorityOpportunities.slice(0, 5).map((o, i) => (
                    <li key={i} className="bg-card border border-border rounded-lg p-3">
                      <span className="font-medium">{o.target_site}</span>
                      <p className="text-muted-foreground">{o.pitch_angle}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-primary/10 border border-primary/20 rounded-xl p-6 text-center">
              <p className="font-semibold mb-2">Want the full picture?</p>
              <p className="text-sm text-muted-foreground mb-4">
                Get competitor analysis, 90-day roadmap, AI visibility across ChatGPT/Perplexity, and white-label PDF.
              </p>
              <Link href="/signup" className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium inline-block">
                Create Free Account
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
