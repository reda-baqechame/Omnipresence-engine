"use client";

interface ReferralRow {
  source: string;
  count: number;
}

const SOURCE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  bing_copilot: "Copilot",
  claude: "Claude",
  you_com: "You.com",
  phind: "Phind",
};

export function LlmReferralChart({ referrals }: { referrals: ReferralRow[] }) {
  const total = referrals.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...referrals.map((r) => r.count), 1);

  if (total === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        No AI referral hits yet. Install the tracking snippet on your site.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h3 className="font-semibold mb-4">LLM Referral Breakdown</h3>
      <div className="space-y-3">
        {referrals.map((row) => (
          <div key={row.source}>
            <div className="flex justify-between text-sm mb-1">
              <span>{SOURCE_LABELS[row.source] || row.source}</span>
              <span className="text-muted-foreground">
                {row.count} ({Math.round((row.count / total) * 100)}%)
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
