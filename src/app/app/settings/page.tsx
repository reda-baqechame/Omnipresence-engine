import Link from "next/link";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      <div className="space-y-4">
        <Link href="/app/settings/billing" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">Account</h3>
          <p className="text-sm text-muted-foreground">Full free access — all features included</p>
        </Link>
        <Link href="/app/settings/whitelabel" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">White-Label Branding</h3>
          <p className="text-sm text-muted-foreground">Customize reports with your agency name, logo, and colors</p>
        </Link>
        <Link href="/app/settings/usage" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">API Usage</h3>
          <p className="text-sm text-muted-foreground">Monitor API credits and usage by provider</p>
        </Link>
        <Link href="/app/settings/setup" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">Production Setup</h3>
          <p className="text-sm text-muted-foreground">Checklist: Supabase, live data, Inngest, OAuth</p>
        </Link>
        <Link href="/app/settings/capabilities" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">Live Providers</h3>
          <p className="text-sm text-muted-foreground">Check which AI/data/social providers are connected</p>
        </Link>
        <Link href="/app/settings/notifications" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">Notifications</h3>
          <p className="text-sm text-muted-foreground">Slack webhooks for weekly score summaries</p>
        </Link>
        <Link href="/app/settings/api" className="block bg-card border border-border rounded-xl p-4 hover:border-primary/50 transition">
          <h3 className="font-semibold">API Keys</h3>
          <p className="text-sm text-muted-foreground">Create keys for the public read + batch-scan API</p>
        </Link>
      </div>
    </div>
  );
}
