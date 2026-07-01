import Link from "next/link";
import { ArrowRight, Globe } from "lucide-react";
import { getBackedMarketingFeatures } from "@/lib/marketing-features";

export default function LandingPage() {
  const features = getBackedMarketingFeatures();
  return (
    <div className="min-h-screen">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">PresenceOS</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-muted-foreground hover:text-foreground transition">Log in</Link>
          <Link href="/signup" className="bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition">
            Start Free Audit
          </Link>
        </div>
      </nav>

      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <div className="inline-block bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          The Organic Visibility Engine
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-tight">
          Be found <span className="text-primary">everywhere</span><br />your customers search
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Audit your visibility across Google, AI chatbots, social platforms, directories, and communities.
          Get the exact plan to become more visible — without increasing ad spend.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/signup" className="bg-primary text-primary-foreground px-8 py-3 rounded-lg font-semibold text-lg hover:opacity-90 transition flex items-center gap-2">
            Run Free Audit <ArrowRight className="h-5 w-5" />
          </Link>
          <Link href="/tools" className="border border-border px-8 py-3 rounded-lg font-semibold text-lg hover:bg-secondary transition">
            Free Tools
          </Link>
          <Link href="/agencies" className="border border-border px-8 py-3 rounded-lg font-semibold text-lg hover:bg-secondary transition hidden sm:inline-block">
            For Agencies
          </Link>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-8">
        {features.map((feature) => (
          <div key={feature.title} className="bg-card border border-border rounded-xl p-6">
            <feature.icon className="h-8 w-8 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
            <p className="text-muted-foreground text-sm">{feature.desc}</p>
          </div>
        ))}
      </section>

      <section className="max-w-7xl mx-auto px-6 py-16 text-center border-t border-border">
        <h2 className="text-3xl font-bold mb-4">Built to reduce dependence on paid ads</h2>
        <p className="text-muted-foreground max-w-xl mx-auto mb-8">
          Paid ads rent attention. PresenceOS builds compounding organic visibility assets that work 24/7.
        </p>
        <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
          {[
            { title: "Full Audits", desc: "OmniPresence Score, technical audit, AI visibility scan, 90-day roadmap" },
            { title: "Tracking & Reports", desc: "Weekly re-scans, competitor movement, white-label PDF reports" },
            { title: "Execution Tools", desc: "Content generation, authority CRM, distribution, attribution" },
          ].map((p) => (
            <div key={p.title} className="bg-card border border-primary/30 rounded-xl p-6">
              <div className="text-sm font-medium text-primary mb-2">Professional beta</div>
              <h3 className="font-semibold text-lg">{p.title}</h3>
              <p className="text-sm text-muted-foreground mt-2">{p.desc}</p>
            </div>
          ))}
        </div>
        <Link href="/signup" className="inline-block mt-8 bg-primary text-primary-foreground px-8 py-3 rounded-lg font-medium hover:opacity-90 transition">
          Start your audit
        </Link>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground space-y-2">
        <p>PresenceOS — The Organic Visibility Engine</p>
        <p className="flex justify-center gap-4">
          <Link href="/privacy" className="hover:text-foreground transition">Privacy</Link>
          <Link href="/terms" className="hover:text-foreground transition">Terms</Link>
        </p>
      </footer>
    </div>
  );
}
