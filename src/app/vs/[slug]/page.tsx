import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe, Check } from "lucide-react";
import { VS_PAGES, getVsPage } from "@/lib/marketing/vs-pages";

export function generateStaticParams() {
  return VS_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getVsPage(slug);
  if (!page) return {};
  return {
    title: `${page.title} (2026) — pricing, engines, evidence`,
    description: page.description,
  };
}

export default async function VsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getVsPage(slug);
  if (!page) notFound();

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
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

      <article className="max-w-4xl mx-auto px-6 py-14">
        <h1 className="text-4xl font-extrabold tracking-tight mb-4">{page.title}</h1>
        <p className="text-lg text-muted-foreground mb-6">{page.description}</p>

        <div className="bg-card border border-border rounded-xl p-5 mb-10">
          <div className="text-sm font-medium mb-1">Fair credit first</div>
          <p className="text-sm text-muted-foreground">{page.strengths}</p>
        </div>

        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm border border-border rounded-xl overflow-hidden">
            <thead>
              <tr className="bg-card text-left">
                <th className="p-3 font-semibold w-1/4">&nbsp;</th>
                <th className="p-3 font-semibold w-[37%]">{page.competitor}</th>
                <th className="p-3 font-semibold w-[37%] text-primary">PresenceOS</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row) => (
                <tr key={row.dimension} className="border-t border-border align-top">
                  <td className="p-3 font-medium">{row.dimension}</td>
                  <td className="p-3 text-muted-foreground">{row.them}</td>
                  <td className="p-3">{row.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mb-10">
          Competitor pricing and packaging reflect their published pages as reviewed in mid-2026 —
          always check their site for current numbers. Our claims match what the product enforces.
        </p>

        <div className="bg-gradient-to-r from-primary/10 to-transparent border border-primary/20 rounded-xl p-6 mb-12">
          <h2 className="font-semibold mb-2">Bottom line</h2>
          <p className="text-sm text-muted-foreground">{page.bottomLine}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-12">
          {[
            "Every feature on every plan — $29 to a hard $199 cap",
            "Hash-chained receipts with public verification pages",
            "Weekly action sprints with honest before/after verdicts",
          ].map((f) => (
            <div key={f} className="flex gap-2 bg-card border border-border rounded-xl p-4">
              <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <span className="text-sm">{f}</span>
            </div>
          ))}
        </div>

        <div className="text-center border-t border-border pt-10">
          <h2 className="text-2xl font-bold mb-3">See your numbers before deciding</h2>
          <p className="text-muted-foreground mb-6">
            Run the free grader — no signup — and compare what each tool would be measuring.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/audit" className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold">
              Run free audit
            </Link>
            <Link href="/pricing" className="border border-border px-6 py-3 rounded-lg font-semibold hover:bg-secondary transition">
              Compare pricing
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
