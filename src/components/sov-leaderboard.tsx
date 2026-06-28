import type { ShareOfVoiceResult } from "@/lib/engines/share-of-voice";

/**
 * Prominence-weighted Share of Voice leaderboard. Unlike a raw mention count,
 * each entity's bar reflects how STRONGLY and how EARLY AI engines recommend it.
 */
export function SovLeaderboard({ sov }: { sov: ShareOfVoiceResult }) {
  if (sov.sampleSize === 0 || sov.leaderboard.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-1">AI Share of Voice</h2>
        <p className="text-sm text-muted-foreground">
          No measured AI answers yet. Run a visibility scan with a connected AI/SERP provider to
          build the competitive leaderboard.
        </p>
      </div>
    );
  }

  const max = Math.max(...sov.leaderboard.map((e) => e.shareOfVoice), 0.0001);

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-semibold">AI Share of Voice</h2>
        {sov.brandRank !== null && (
          <span className="text-sm font-medium text-muted-foreground">
            You rank{" "}
            <strong className={sov.brandRank === 1 ? "text-green-400" : "text-primary"}>
              #{sov.brandRank}
            </strong>{" "}
            of {sov.leaderboard.length}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Prominence-weighted across {sov.sampleSize} measured AI answer{sov.sampleSize === 1 ? "" : "s"} —
        a mention as the #1 pick counts more than a passing mention near the bottom.
      </p>

      <div className="space-y-2.5">
        {sov.leaderboard.map((e) => (
          <div key={e.name} className="flex items-center gap-3">
            <div className="w-32 shrink-0 truncate text-sm font-medium" title={e.name}>
              {e.isBrand ? (
                <span className="text-primary">{e.name} (you)</span>
              ) : (
                e.name
              )}
            </div>
            <div className="flex-1 h-6 bg-muted/40 rounded-md overflow-hidden">
              <div
                className={`h-full rounded-md ${e.isBrand ? "bg-primary" : "bg-muted-foreground/50"}`}
                style={{ width: `${Math.max(2, (e.shareOfVoice / max) * 100)}%` }}
              />
            </div>
            <div className="w-44 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground">{Math.round(e.shareOfVoice * 100)}%</span>
              {" · "}
              {e.appearances} hit{e.appearances === 1 ? "" : "s"}
              {e.avgPosition !== null && <> · avg #{e.avgPosition}</>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
