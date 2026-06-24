import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="min-h-screen max-w-3xl mx-auto px-6 py-16">
      <Link href="/" className="text-sm text-primary hover:underline mb-8 inline-block">
        ← Back to PresenceOS
      </Link>
      <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
      <div className="prose prose-invert space-y-4 text-muted-foreground text-sm leading-relaxed">
        <p>Last updated: {new Date().toLocaleDateString()}</p>
        <p>
          By using PresenceOS, you agree to these terms. The service is provided &quot;as is&quot;
          during the current free-access period.
        </p>
        <h2 className="text-lg font-semibold text-foreground pt-4">Service description</h2>
        <p>
          PresenceOS provides organic visibility auditing, AI/search tracking, content tools, and
          reporting. We do not guarantee specific search rankings, AI placement, or traffic outcomes.
        </p>
        <h2 className="text-lg font-semibold text-foreground pt-4">Acceptable use</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Do not abuse rate limits or attempt unauthorized access</li>
          <li>Do not use generated content for spam or policy-violating activity</li>
          <li>You are responsible for content published via connected platforms</li>
        </ul>
        <h2 className="text-lg font-semibold text-foreground pt-4">Limitation of liability</h2>
        <p>
          PresenceOS is not liable for indirect damages arising from use of the platform. Visibility
          metrics are estimates based on sampling, not ground truth.
        </p>
      </div>
    </div>
  );
}
