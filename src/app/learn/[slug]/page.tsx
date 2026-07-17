import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Globe } from "lucide-react";
import { LEARN_PAGES, getLearnPage } from "@/lib/marketing/learn-pages";

export function generateStaticParams() {
  return LEARN_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getLearnPage(slug);
  if (!page) return {};
  return { title: `${page.title} — PresenceOS`, description: page.description };
}

export default async function LearnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = getLearnPage(slug);
  if (!page) notFound();

  const others = LEARN_PAGES.filter((p) => p.slug !== slug).slice(0, 3);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
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

      <article className="max-w-3xl mx-auto px-6 py-14">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-5">{page.title}</h1>
        <p className="text-lg text-muted-foreground mb-10">{page.intro}</p>

        <div className="space-y-8 mb-12">
          {page.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-xl font-semibold mb-2">{s.heading}</h2>
              <p className="text-muted-foreground leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>

        <div className="bg-gradient-to-r from-primary/10 to-transparent border border-primary/20 rounded-xl p-6 text-center mb-12">
          <p className="text-sm text-muted-foreground mb-4">{page.cta}</p>
          <Link href="/audit" className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold">
            Run the free grader
          </Link>
          <p className="text-xs text-muted-foreground mt-3">No signup required · results include verifiable receipts</p>
        </div>

        {others.length > 0 && (
          <div className="border-t border-border pt-8">
            <h2 className="font-semibold mb-4">Keep reading</h2>
            <ul className="space-y-2">
              {others.map((p) => (
                <li key={p.slug}>
                  <Link href={`/learn/${p.slug}`} className="text-sm text-primary hover:underline">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>
    </div>
  );
}
