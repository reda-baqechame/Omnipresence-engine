import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-primary hover:underline mb-8 inline-block">
        ← Back to PresenceOS
      </Link>
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <div className="prose prose-invert space-y-4 text-muted-foreground text-sm leading-relaxed">
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        <p>
          PresenceOS (&quot;we&quot;) collects information you provide when creating an account,
          running audits, and connecting third-party services (Google, Bing, analytics tools).
        </p>
        <h2 className="text-lg font-semibold text-foreground pt-4">Data we collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Account email and organization name</li>
          <li>Project domains, brand data, and audit results</li>
          <li>OAuth tokens for connected analytics platforms (stored encrypted)</li>
          <li>Usage logs for service improvement</li>
        </ul>
        <h2 className="text-lg font-semibold text-foreground pt-4">How we use data</h2>
        <p>
          We use your data solely to provide visibility auditing, tracking, reporting, and related
          features. We do not sell personal data to third parties.
        </p>
        <h2 className="text-lg font-semibold text-foreground pt-4">Contact</h2>
        <p>
          For privacy requests, contact your account administrator or the email address listed on
          your PresenceOS deployment.
        </p>
      </div>
    </div>
  );
}
