import Link from "next/link";
import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Measurement methodology & live volatility data — PresenceOS",
  description:
    "How PresenceOS measures AI visibility: multi-run panels, Wilson confidence intervals, sample-size floors, and hash-chained receipts — plus our own live engine non-determinism data, published openly.",
};

interface VolatilityAggregate {
  panelRuns: number;
  totalObservations: number;
  avgRepeatedRun: number | null;
  avgPrompt: number | null;
  avgEngine: number | null;
}

/**
 * Aggregate non-determinism data across ALL panel runs on the platform —
 * counts and dispersion statistics only, never brands, prompts, or tenants.
 * This is the "publish your own volatility data" proof channel from the
 * master plan: most tools hide run-to-run variance; we lead with it.
 */
async function getVolatilityAggregate(): Promise<VolatilityAggregate | null> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("ai_panel_runs")
      .select("sample_size, stats")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!data || data.length === 0) return null;

    let totalObservations = 0;
    const repeated: number[] = [];
    const prompt: number[] = [];
    const engine: number[] = [];
    for (const run of data) {
      totalObservations += Number(run.sample_size) || 0;
      const v = (run.stats as { volatility?: Record<string, number | null> } | null)?.volatility;
      if (v?.repeated_run != null) repeated.push(Number(v.repeated_run));
      if (v?.prompt != null) prompt.push(Number(v.prompt));
      if (v?.engine != null) engine.push(Number(v.engine));
    }
    const avg = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    return {
      panelRuns: data.length,
      totalObservations,
      avgRepeatedRun: avg(repeated),
      avgPrompt: avg(prompt),
      avgEngine: avg(engine),
    };
  } catch {
    return null;
  }
}

function pct(x: number | null): string {
  return x == null ? "—" : `±${(x * 100).toFixed(1)}pp`;
}

export default async function MethodologyPage() {
  const vol = await getVolatilityAggregate();
  const hasData = Boolean(vol && vol.panelRuns >= 5);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition">Pricing</Link>
          <Link href="/audit" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">
            Free audit
          </Link>
        </div>
      </nav>

      <section className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight mb-4">
          How we measure — and why we publish our own noise
        </h1>
        <p className="text-muted-foreground text-lg">
          AI answers are non-deterministic: the same prompt on the same engine can name your brand
          at 9am and skip it at noon. Any tool that turns one run into a score is selling noise.
          This page documents exactly how PresenceOS measures — and publishes our own live
          volatility data, because a measurement company should show its error bars.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-8">
        <h2 className="text-2xl font-bold mb-4">Live platform volatility data</h2>
        {hasData && vol ? (
          <>
            <div className="grid sm:grid-cols-3 gap-4 mb-4">
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-3xl font-bold">{pct(vol.avgRepeatedRun)}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Run-to-run volatility — the same prompt, engine, and setup, repeated. Pure model
                  randomness.
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-3xl font-bold">{pct(vol.avgPrompt)}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Prompt volatility — how much mention rates differ between prompts in the same
                  category.
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-5">
                <div className="text-3xl font-bold">{pct(vol.avgEngine)}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Engine disagreement — how much engines differ from each other on identical
                  prompts.
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Aggregated across the last {vol.panelRuns} multi-run panels (
              {vol.totalObservations.toLocaleString()} measured observations) on this platform.
              Counts and dispersion only — no brands, prompts, or customer data. Updated live.
            </p>
          </>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
            Aggregate volatility statistics are published here automatically once enough multi-run
            panels have accumulated (we require at least 5 panels before showing aggregates — the
            same sample-floor discipline we apply to your data).
          </div>
        )}
      </section>

      <section className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h2 className="text-2xl font-bold mb-2">Multi-run panels, not screenshots</h2>
          <p className="text-muted-foreground text-sm">
            Every headline number comes from repeated runs of each prompt × engine cell — minimum 3
            runs per cell. Panel runs always hit the live provider (they are never served from any
            cache), because run-to-run variance is precisely what we are measuring.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">Sample-size floors</h2>
          <p className="text-muted-foreground text-sm">
            We refuse to print a headline rate below 50 measured observations, a directional rate
            below 30, or a per-engine trend below 30 observations for that engine. Below the floor
            the UI says &quot;insufficient sample&quot; — not a confident-looking number.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">Wilson confidence intervals</h2>
          <p className="text-muted-foreground text-sm">
            Every mention rate ships with its 95% Wilson interval, the small-sample-robust CI used
            in polling. A 40% mention rate on n=30 reads &quot;40% (25–57%)&quot; — the honesty is
            in the parentheses.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">Measured means measured</h2>
          <p className="text-muted-foreground text-sm">
            Every result row is labeled: <em>measured</em> (a real engine answered),{" "}
            <em>model knowledge</em> (an ungrounded LLM response, counted separately), or{" "}
            <em>unavailable</em> (we tried and couldn&apos;t measure — never rendered as
            &quot;not mentioned&quot;). Citation rates only count grounded answers with real cited
            URLs. Surfaces are never merged: a ChatGPT UI capture and an OpenAI API response are
            different measurements and are labeled as such.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">Volatility separated by cause</h2>
          <p className="text-muted-foreground text-sm">
            Run-to-run randomness, prompt differences, engine disagreement, geography, and persona
            variation are different phenomena. We compute and report them separately — blending
            them into one &quot;volatility index&quot; would hide what you can act on.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">Receipts: verify without trusting us</h2>
          <p className="text-muted-foreground text-sm">
            Every measured answer produces an evidence record: prompt, exact surface, timestamp,
            raw answer, cited URLs, and a SHA-256 hash chained to the previous receipt. Public{" "}
            <code className="text-xs">/verify</code> pages recompute the hashes so anyone — you, a
            client, an auditor — can confirm a number without trusting our dashboard.
          </p>
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">Before/after with honest verdicts</h2>
          <p className="text-muted-foreground text-sm">
            Sprint outcomes are classified as verified / increased / unchanged / declined /
            inconclusive against a pre-registered movement threshold (3pp) and sample floor.
            &quot;Unchanged&quot; is a real verdict we ship, and correlation is labeled as
            correlation.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-16 text-center border-t border-border">
        <h2 className="text-2xl font-bold mb-3">See it on your own brand</h2>
        <p className="text-muted-foreground mb-6">
          The free audit runs real engine probes with the same methodology — measured results,
          honest gaps, no signup.
        </p>
        <Link
          href="/audit"
          className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium inline-block"
        >
          Run the free audit
        </Link>
      </section>
    </div>
  );
}
