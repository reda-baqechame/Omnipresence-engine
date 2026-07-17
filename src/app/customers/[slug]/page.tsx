import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Globe, ShieldCheck } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { checkPublicPageRateLimit } from "@/lib/security/public-guard";
import { RateLimitedNotice } from "@/components/rate-limited-notice";
import type { SprintSnapshot } from "@/lib/engines/action-sprint";

export const dynamic = "force-dynamic";

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/**
 * Public case study page — published + consented rows only. Every headline
 * number is shown next to its measured sample size, and the receipt list links
 * to the public /verify pages so anyone can audit the evidence chain.
 */
export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const rateLimit = await checkPublicPageRateLimit(await headers(), "case-study-view", 60, 60_000);
  if (!rateLimit.allowed) {
    return <RateLimitedNotice retryAfterSec={rateLimit.retryAfterSec} />;
  }

  const supabase = await createServiceClient();
  const { data: study } = await supabase
    .from("case_studies")
    .select("title, summary, brand_name, agency_name, baseline, outcome, outcome_verdict, receipt_ids, published_at")
    .eq("slug", slug)
    .eq("published", true)
    .eq("consent_confirmed", true)
    .maybeSingle();
  if (!study) notFound();

  const baseline = study.baseline as SprintSnapshot | null;
  const outcome = study.outcome as SprintSnapshot | null;
  const receiptIds = (Array.isArray(study.receipt_ids) ? study.receipt_ids : []) as string[];

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
        <Link href="/customers" className="text-sm text-muted-foreground hover:text-foreground transition">
          ← All case studies
        </Link>
      </nav>

      <article className="max-w-3xl mx-auto px-6 py-14">
        <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-medium mb-5">
          <ShieldCheck className="h-3.5 w-3.5" /> Named with consent · backed by receipts
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">{study.title}</h1>
        <p className="text-muted-foreground mb-8">{study.summary}</p>

        {baseline && outcome && (
          <div className="grid md:grid-cols-2 gap-4 mb-10">
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="text-sm text-muted-foreground mb-1">Before (baseline panel)</div>
              <div className="text-2xl font-bold">{pct(baseline.mention_rate)} mentions</div>
              <div className="text-sm text-muted-foreground mt-1">
                {pct(baseline.citation_rate)} citations · {baseline.sample_size} measured answers
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Captured {new Date(baseline.captured_at).toLocaleDateString()}
              </div>
            </div>
            <div className="bg-card border border-primary/40 rounded-xl p-5">
              <div className="text-sm text-muted-foreground mb-1">After (remeasured panel)</div>
              <div className="text-2xl font-bold text-primary">{pct(outcome.mention_rate)} mentions</div>
              <div className="text-sm text-muted-foreground mt-1">
                {pct(outcome.citation_rate)} citations · {outcome.sample_size} measured answers
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Captured {new Date(outcome.captured_at).toLocaleDateString()} · verdict:{" "}
                <span className="capitalize font-medium">{study.outcome_verdict}</span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 mb-10">
          <h2 className="font-semibold mb-2">Methodology</h2>
          <p className="text-sm text-muted-foreground">
            Both panels ran the same approved prompts across the same AI surfaces with repeated
            runs. Rates are computed only over measured answers (never estimates), and verdicts
            require a minimum sample on both sides — thin samples are reported as inconclusive,
            not as wins. Movement is correlation with the sprint&apos;s fixes, not proven causation.
          </p>
        </div>

        {receiptIds.length > 0 && (
          <div>
            <h2 className="font-semibold mb-3">Verify the receipts</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Each receipt below recomputes its sha256 hash and chain link live — independently of
              this page.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {receiptIds.map((id) => (
                <Link
                  key={id}
                  href={`/verify/${id}`}
                  className="text-sm font-mono bg-card border border-border rounded-lg px-3 py-2 hover:border-primary/50 transition truncate"
                >
                  {id}
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-14 text-center border-t border-border pt-10">
          <h2 className="text-2xl font-bold mb-3">Want numbers like these — with proof?</h2>
          <Link
            href="/signup"
            className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold"
          >
            Start free
          </Link>
        </div>
      </article>
    </div>
  );
}
