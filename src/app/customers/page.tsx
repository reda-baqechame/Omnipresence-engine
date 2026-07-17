import Link from "next/link";
import type { Metadata } from "next";
import { Globe } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Customer results — PresenceOS",
  description:
    "Named case studies backed by verifiable receipts. Every number links to hash-chained evidence you can independently verify.",
};

interface PublicCaseStudy {
  slug: string;
  title: string;
  summary: string | null;
  brand_name: string;
  agency_name: string | null;
  outcome_verdict: string | null;
  published_at: string | null;
}

export default async function CustomersPage() {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("case_studies")
    .select("slug, title, summary, brand_name, agency_name, outcome_verdict, published_at")
    .eq("published", true)
    .eq("consent_confirmed", true)
    .order("published_at", { ascending: false })
    .limit(50);
  const studies = (data || []) as PublicCaseStudy[];

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <Link href="/" className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition">Pricing</Link>
          <Link href="/signup" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium">
            Start free
          </Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 py-16 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight mb-4">Results with receipts</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Every case study below is generated from measured sprint data — real prompts, real
          engines, honest before/after verdicts — and each one links to hash-chained receipts you
          can verify yourself. Names appear only with explicit consent.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-24">
        {studies.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <p className="text-muted-foreground mb-2 font-medium">
              No published case studies yet — and that&apos;s deliberate.
            </p>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              We only publish results measured through the product with named consent. Fabricated
              logos and made-up percentages don&apos;t appear here. Founding pilot results will be
              published as sprints complete.
            </p>
            <Link
              href="/agencies"
              className="inline-block mt-6 bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium"
            >
              Join the founding pilot program
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {studies.map((s) => (
              <Link
                key={s.slug}
                href={`/customers/${s.slug}`}
                className="block bg-card border border-border rounded-xl p-6 hover:border-primary/50 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{s.title}</h2>
                    <p className="text-sm text-muted-foreground mt-1">{s.summary}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {s.brand_name}
                      {s.agency_name ? ` × ${s.agency_name}` : ""}
                    </p>
                  </div>
                  {s.outcome_verdict && (
                    <span className="shrink-0 text-xs border border-border rounded-full px-3 py-1 capitalize">
                      {s.outcome_verdict}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
