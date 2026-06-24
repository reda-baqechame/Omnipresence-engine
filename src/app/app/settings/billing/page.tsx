export default function BillingPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Account</h1>
      <p className="text-muted-foreground mb-8">
        PresenceOS is currently free for everyone. All features are unlocked — unlimited projects,
        full scans, content generation, white-label reports, attribution, and distribution tools.
      </p>

      <div className="bg-card border border-primary/30 rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-primary">Full access included</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "Unlimited client projects",
            "Full OmniPresence audits & re-scans",
            "AI visibility tracking across all engines",
            "Content generation (all 18 asset types)",
            "Authority outreach CRM",
            "White-label PDF reports",
            "GSC, Bing, GA4 & Plausible attribution",
            "Directory tracker & IndexNow submission",
            "Weekly email & Slack reports",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground pt-2">
          Paid plans may be introduced later. Your usage is not metered or restricted during this period.
        </p>
      </div>
    </div>
  );
}
