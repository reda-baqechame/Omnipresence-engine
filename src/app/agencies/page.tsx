import Link from "next/link";
import { Globe, ArrowRight, CheckCircle, FileText, Users, BarChart3 } from "lucide-react";
import { canRenderClaim } from "@/lib/config/claims";

const AGENCY_FEATURES = [
  { claimId: "guarantee_deterministic", icon: FileText, title: "White-Label PDF Reports", desc: "Your agency name, logo, and colors on every client report. Resell audits to clients at your own price." },
  { claimId: "technical_audit", icon: Users, title: "Multi-Client Projects", desc: "One agency account manages all client projects. Agency plans scale with your portfolio." },
  { claimId: "ai_visibility_tracking", icon: BarChart3, title: "AI Visibility Tracking", desc: "Track ChatGPT, Perplexity, Gemini, Google AI Overviews. Prove movement month over month." },
] as const;

export default function AgenciesPage() {
  const features = AGENCY_FEATURES.filter((f) => canRenderClaim(f.claimId));
  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
        <Link href="/signup" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">
          Get started free
        </Link>
      </nav>

      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <div className="inline-block bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          Built for SEO & AI Agencies
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight mb-6 leading-tight">
          White-label OmniPresence audits<br />
          <span className="text-primary">your clients will actually pay for</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Show clients exactly why they are invisible across Google, AI search, social, and directories —
          then sell them the fix. One agency account, unlimited client projects.
        </p>
        <Link href="/signup" className="bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold text-lg inline-flex items-center gap-2">
          Get started free <ArrowRight className="h-5 w-5" />
        </Link>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-8">
        {features.map((f) => (
          <div key={f.title} className="bg-card border border-border rounded-xl p-6">
            <f.icon className="h-8 w-8 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
            <p className="text-muted-foreground text-sm">{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-10">What you deliver to every client</h2>
        <div className="space-y-4">
          {[
            "OmniPresence Score (0–100) with 8 sub-scores",
            "AI visibility scan across ChatGPT, Perplexity, Gemini, Google AI",
            "Technical readiness audit (robots.txt, schema, AI bot access)",
            "15+ platform coverage check (social, directories, reviews)",
            "Competitor gap analysis and authority opportunities",
            "90-day execution roadmap ranked by revenue impact",
            "Monthly re-scans with trend charts",
            "White-label branded PDF export",
          ].map((item) => (
            <div key={item} className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-primary shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-border">
        <div className="bg-card border border-primary/30 rounded-2xl p-8 text-center">
          <div className="inline-block bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-4">
            Founding pilot program — 5 agencies
          </div>
          <h2 className="text-3xl font-bold mb-3">Free Agency plan for a named case study</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-2">
            Run one real client through the full loop — baseline panel, weekly action sprints,
            remeasured outcome — and get the Agency plan free for 6 months. In exchange, we publish
            the measured before/after as a named case study, every number backed by verifiable
            receipts.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            If the numbers don&apos;t move, we publish nothing and you keep the free months. We only
            publish honest wins — see <Link href="/customers" className="text-primary hover:underline">results with receipts</Link>.
          </p>
          <Link href="/signup?pilot=agency" className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold">
            Apply — create your account
          </Link>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 border-t border-border">
        <h2 className="text-3xl font-bold text-center mb-3">The Proof Audit — your client entry offer</h2>
        <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-8">
          A productized, resellable audit: multi-run baseline panel across every engine, competitor
          share of voice, claim review, source/citation gaps, and a prioritized action plan — every
          number with a verifiable receipt. Sell it to prospects, keep your margin.
        </p>
        <div className="grid md:grid-cols-2 gap-4 max-w-3xl mx-auto">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="text-sm text-muted-foreground mb-1">Automated Proof Audit</div>
            <div className="text-3xl font-bold mb-3">$990</div>
            <p className="text-sm text-muted-foreground mb-4">
              Runs through the product: baseline panel, receipts portal, gap analysis, white-label
              PDF. Agencies typically resell at $2,000–3,500.
            </p>
            <a
              href="mailto:hello@presenceos.app?subject=Proof%20Audit%20($990)"
              className="inline-block border border-border px-5 py-2 rounded-lg text-sm font-medium hover:bg-secondary transition"
            >
              Order a Proof Audit
            </a>
          </div>
          <div className="bg-card border border-primary/30 rounded-xl p-6">
            <div className="text-sm text-muted-foreground mb-1">Human-reviewed Proof Audit</div>
            <div className="text-3xl font-bold mb-3">$1,500–3,000</div>
            <p className="text-sm text-muted-foreground mb-4">
              Everything in the automated audit plus analyst review: buyer-prompt research, false-claim
              validation, and an executive readout you can present directly to the client.
            </p>
            <a
              href="mailto:hello@presenceos.app?subject=Human-reviewed%20Proof%20Audit"
              className="inline-block bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium"
            >
              Request a scope
            </a>
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 text-center border-t border-border">
        <h2 className="text-3xl font-bold mb-4">Professional beta</h2>
        <p className="text-muted-foreground mb-2 max-w-xl mx-auto">
          Three plans, every feature on all of them, hard-capped at $199/mo. Plans differ only in
          capacity — brands, prompts, and monthly observations.
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          <Link href="/pricing" className="text-primary hover:underline">See pricing and the plan calculator →</Link>
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/audit" className="border border-border px-6 py-2 rounded-lg font-medium hover:bg-secondary transition">
            Try Free Audit First
          </Link>
          <Link href="/signup" className="bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium">
            Create Free Account
          </Link>
        </div>
      </section>
    </div>
  );
}
