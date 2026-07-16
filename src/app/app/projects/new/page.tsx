"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Briefcase, Building2, Check, Loader2, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";

const STEPS = ["Who", "Domain", "Brand", "Competitors", "Prompts"] as const;

interface AnalyzedCompetitor {
  name: string;
  domain: string | null;
  confidence: number;
  evidence_url?: string;
}

interface SuggestedPrompt {
  text: string;
  category: string;
  priority: number;
}

interface Analysis {
  brandName: string;
  industry: string;
  businessDescription: string;
  buyerCategories: string[];
  locationHint: string | null;
  competitors: AnalyzedCompetitor[];
  suggestedPrompts: SuggestedPrompt[];
  inferenceGrounded: boolean;
}

const ANALYZE_MESSAGES = [
  "Reading the homepage...",
  "Identifying the business and buyer categories...",
  "Finding likely competitors...",
  "Verifying competitor domains...",
  "Drafting buyer-intent prompts...",
];

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [clientMode, setClientMode] = useState<"myself" | "client" | null>(null);
  const [domain, setDomain] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMessage, setAnalyzeMessage] = useState(ANALYZE_MESSAGES[0]);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  const [brand, setBrand] = useState({ name: "", industry: "", location: "" });
  const [selectedCompetitors, setSelectedCompetitors] = useState<string[]>([]);
  const [customCompetitor, setCustomCompetitor] = useState("");
  const [competitorPool, setCompetitorPool] = useState<AnalyzedCompetitor[]>([]);
  const [selectedPrompts, setSelectedPrompts] = useState<Set<string>>(new Set());
  const [promptPool, setPromptPool] = useState<SuggestedPrompt[]>([]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function analyzeDomain() {
    setAnalyzing(true);
    setAnalyzeError(null);
    let i = 0;
    const ticker = setInterval(() => {
      i = Math.min(i + 1, ANALYZE_MESSAGES.length - 1);
      setAnalyzeMessage(ANALYZE_MESSAGES[i]);
    }, 5000);
    try {
      const res = await fetch("/api/onboarding/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Analysis failed");
      }
      const { analysis: a } = (await res.json()) as { analysis: Analysis };
      setAnalysis(a);
      setBrand({
        name: a.brandName || "",
        industry: a.industry || "",
        location: a.locationHint || "",
      });
      setCompetitorPool(a.competitors);
      setSelectedCompetitors(a.competitors.filter((c) => c.confidence >= 0.5).map((c) => c.name));
      setPromptPool(a.suggestedPrompts);
      setSelectedPrompts(new Set(a.suggestedPrompts.slice(0, 15).map((p) => p.text)));
      setStep(2);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      clearInterval(ticker);
      setAnalyzing(false);
      setAnalyzeMessage(ANALYZE_MESSAGES[0]);
    }
  }

  function skipAnalysis() {
    setAnalysis(null);
    setCompetitorPool([]);
    setSelectedCompetitors([]);
    setPromptPool([]);
    setSelectedPrompts(new Set());
    setStep(2);
  }

  function addCustomCompetitor() {
    const name = customCompetitor.trim();
    if (!name || competitorPool.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
    setCompetitorPool((prev) => [...prev, { name, domain: null, confidence: 0 }]);
    setSelectedCompetitors((prev) => [...prev, name]);
    setCustomCompetitor("");
  }

  function toggleCompetitor(name: string) {
    setSelectedCompetitors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : prev.length < 10 ? [...prev, name] : prev
    );
  }

  function addCustomPrompt() {
    const text = customPrompt.trim().slice(0, 180);
    if (!text || promptPool.some((p) => p.text.toLowerCase() === text.toLowerCase())) return;
    setPromptPool((prev) => [{ text, category: "custom", priority: 90 }, ...prev]);
    setSelectedPrompts((prev) => new Set([text, ...prev]));
    setCustomPrompt("");
  }

  function togglePrompt(text: string) {
    setSelectedPrompts((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else if (next.size < 60) next.add(text);
      return next;
    });
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    const approved = promptPool
      .filter((p) => selectedPrompts.has(p.text))
      .map((p) => ({ text: p.text, category: p.category === "custom" ? undefined : p.category, priority: p.priority }));
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: brand.name,
        domain,
        industry: brand.industry,
        location: brand.location || undefined,
        competitors: selectedCompetitors,
        client_mode: clientMode ?? undefined,
        approved_prompts: approved.length > 0 ? approved : undefined,
      }),
    });
    if (res.ok) {
      const { project } = await res.json();
      router.push(`/app/projects/${project.id}?scan=start`);
    } else {
      const body = await res.json().catch(() => null);
      setCreateError(body?.error || "Project creation failed");
      setCreating(false);
    }
  }

  const promptsByCategory = promptPool.reduce<Record<string, SuggestedPrompt[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/app" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <h1 className="text-3xl font-bold mb-2">Track a brand in AI search</h1>
      <p className="text-muted-foreground mb-8">
        From domain to a measured, evidence-backed AI visibility baseline. You approve every prompt before anything runs.
      </p>

      <div className="flex gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className={`flex-1 h-1 rounded-full ${i <= step ? "bg-primary" : "bg-secondary"}`} />
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        {step === 0 && (
          <>
            <h2 className="font-semibold">Who are you setting this up for?</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => { setClientMode("myself"); setStep(1); }}
                className="border border-border rounded-xl p-5 text-left hover:border-primary transition-colors"
              >
                <Building2 className="h-6 w-6 text-primary mb-2" />
                <div className="font-medium">My own brand</div>
                <p className="text-sm text-muted-foreground mt-1">Track how AI engines recommend my company.</p>
              </button>
              <button
                onClick={() => { setClientMode("client"); setStep(1); }}
                className="border border-border rounded-xl p-5 text-left hover:border-primary transition-colors"
              >
                <Briefcase className="h-6 w-6 text-primary mb-2" />
                <div className="font-medium">A client</div>
                <p className="text-sm text-muted-foreground mt-1">
                  I&apos;m an agency — white-label reports and client portals are included on every plan.
                </p>
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="font-semibold">{clientMode === "client" ? "Client website" : "Your website"}</h2>
            <div>
              <label className="block text-sm font-medium mb-1.5">Domain *</label>
              <input
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                placeholder="example.com"
                title="Website domain"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={analyzing}
                required
              />
              <p className="mt-2 text-xs text-muted-foreground">
                We read the homepage to identify the business, likely competitors, and the buyer prompts worth tracking — before any scan spends a single credit.
              </p>
            </div>
            {analyzeError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                {analyzeError} — you can retry or continue with manual setup.
              </div>
            )}
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep(0)} className="text-sm text-muted-foreground hover:text-foreground">Back</button>
              <div className="flex items-center gap-3">
                {(analyzeError || domain) && !analyzing && (
                  <button onClick={skipAnalysis} disabled={!domain} className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
                    Set up manually
                  </button>
                )}
                <button
                  onClick={analyzeDomain}
                  disabled={!domain || analyzing}
                  className="bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                >
                  {analyzing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {analyzeMessage}</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> Analyze domain</>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="font-semibold">Confirm the brand</h2>
            {analysis?.businessDescription && (
              <p className="text-sm text-muted-foreground bg-background border border-border rounded-lg p-3">
                {analysis.businessDescription}
                {analysis.buyerCategories.length > 0 && (
                  <span className="block mt-1.5 text-xs">Buyers: {analysis.buyerCategories.join(", ")}</span>
                )}
              </p>
            )}
            <div>
              <label className="block text-sm font-medium mb-1.5">Brand Name *</label>
              <input value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} placeholder="Acme Inc." title="Brand name"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Industry *</label>
              <input value={brand.industry} onChange={(e) => setBrand({ ...brand, industry: e.target.value })} placeholder="e.g. Skincare, B2B SaaS, Dental"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Location (optional)</label>
              <input value={brand.location} onChange={(e) => setBrand({ ...brand, location: e.target.value })} placeholder="e.g. Austin, TX — leave blank if not local"
                className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="text-sm text-muted-foreground hover:text-foreground">Back</button>
              <button onClick={() => setStep(3)} disabled={!brand.name || !brand.industry}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                Next <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="font-semibold">Confirm competitors</h2>
            <p className="text-sm text-muted-foreground">
              {competitorPool.length > 0
                ? "Detected from the market context — uncheck anything wrong. Each verified domain comes with SERP evidence."
                : "Add the competitors AI engines are most likely to recommend instead of this brand."}
            </p>
            <div className="space-y-2">
              {competitorPool.map((c) => (
                <label key={c.name} className="flex items-center gap-3 bg-background border border-border rounded-lg px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCompetitors.includes(c.name)}
                    onChange={() => toggleCompetitor(c.name)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.domain ? (
                    <span className="text-xs text-muted-foreground">{c.domain}</span>
                  ) : c.confidence === 0 && c.evidence_url === undefined ? null : (
                    <span className="text-xs text-amber-500">unverified</span>
                  )}
                  {c.confidence >= 0.7 && <Check className="h-3.5 w-3.5 text-green-500 ml-auto" />}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={customCompetitor}
                onChange={(e) => setCustomCompetitor(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomCompetitor(); } }}
                placeholder="Add a competitor by name"
                title="Add competitor"
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={addCustomCompetitor} className="border border-border rounded-lg px-3 text-sm flex items-center gap-1 hover:border-primary" title="Add competitor" aria-label="Add competitor">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(2)} className="text-sm text-muted-foreground hover:text-foreground">Back</button>
              <button onClick={() => setStep(4)}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1">
                Next <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="font-semibold">Approve tracking prompts</h2>
            <p className="text-sm text-muted-foreground">
              {promptPool.length > 0 ? (
                <>These are the buyer questions we&apos;ll measure across AI engines. <span className="font-medium text-foreground">{selectedPrompts.size} selected</span> — nothing runs without your approval.</>
              ) : (
                "No suggestions available — add prompts below, or create the project and PresenceOS will research a prompt universe from live SERP data."
              )}
            </p>
            <div className="flex gap-2">
              <input
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomPrompt(); } }}
                placeholder="Add your own prompt, e.g. best CRM for small agencies"
                title="Add prompt"
                className="flex-1 bg-background border border-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button onClick={addCustomPrompt} className="border border-border rounded-lg px-3 text-sm flex items-center gap-1 hover:border-primary" title="Add prompt" aria-label="Add prompt">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-4 pr-1">
              {Object.entries(promptsByCategory).map(([category, prompts]) => (
                <div key={category}>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    {category.replace(/_/g, " ")}
                  </div>
                  <div className="space-y-1.5">
                    {prompts.map((p) => (
                      <label key={p.text} className="flex items-start gap-2.5 bg-background border border-border rounded-lg px-3 py-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPrompts.has(p.text)}
                          onChange={() => togglePrompt(p.text)}
                          className="h-4 w-4 mt-0.5 accent-[var(--primary)]"
                        />
                        <span className="text-sm">{p.text}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {createError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center gap-2">
                <X className="h-4 w-4" /> {createError}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(3)} className="text-sm text-muted-foreground hover:text-foreground">Back</button>
              <button
                onClick={handleCreate}
                disabled={creating || (promptPool.length > 0 && selectedPrompts.size < 5)}
                className="bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                {creating ? (<><Loader2 className="h-4 w-4 animate-spin" /> Creating &amp; starting baseline scan...</>) : "Create & run baseline scan"}
              </button>
            </div>
            {promptPool.length > 0 && selectedPrompts.size < 5 && (
              <p className="text-xs text-muted-foreground text-right">Select at least 5 prompts for a meaningful baseline.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
