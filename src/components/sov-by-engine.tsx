import type { SovByEngine } from "@/lib/engines/share-of-voice";

const ENGINE_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  google_ai_overview: "Google AI Overview",
  google_organic: "Google Search",
};

function label(engine: string): string {
  return ENGINE_LABELS[engine] || engine.replace(/_/g, " ");
}

/**
 * Per-engine Share of Voice — shows the surfaces where the brand wins vs loses,
 * so optimization effort can be aimed at the specific engines where competitors
 * out-rank them.
 */
export function SovByEngineBreakdown({ data }: { data: SovByEngine[] }) {
  if (data.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-1">Share of Voice by Engine</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Where you win and lose across AI engines — same prominence-weighted methodology, sliced by surface.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {data.map(({ engine, sov }) => {
          const brandShare = Math.round((sov.brand?.shareOfVoice ?? 0) * 100);
          const leader = sov.leaderboard[0];
          const brandIsLeader = sov.brandRank === 1;
          return (
            <div key={engine} className="border border-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{label(engine)}</span>
                <span className={`text-xs font-semibold ${brandIsLeader ? "text-green-400" : sov.brandRank ? "text-primary" : "text-muted-foreground"}`}>
                  {sov.brandRank ? `#${sov.brandRank}` : "absent"}
                </span>
              </div>
              <div className="text-2xl font-bold text-primary">{brandShare}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {brandIsLeader
                  ? "You lead this engine"
                  : leader
                    ? `Leader: ${leader.name}${leader.isBrand ? " (you)" : ""} ${Math.round(leader.shareOfVoice * 100)}%`
                    : "No data"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
