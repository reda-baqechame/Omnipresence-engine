import type { HonestVisibilitySnapshot } from "@/lib/engines/visibility-scope";

export function VisibilityHonestyBanner({ snapshot }: { snapshot: HonestVisibilitySnapshot }) {
  if (!snapshot.reliabilityNote) return null;

  const tone =
    snapshot.groundedCount === 0
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : "border-amber-500/40 bg-amber-500/10 text-amber-200";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-medium">Measurement coverage is too thin for headline rates</p>
      <p className="mt-1 text-xs opacity-90">{snapshot.reliabilityNote}</p>
      {snapshot.groundedCount > 0 && (
        <p className="mt-2 text-xs opacity-80">
          Grounded probes in latest run: {snapshot.groundedCount} · Unavailable: {snapshot.unavailableCount}
        </p>
      )}
    </div>
  );
}

export function VisibilityMetricTiles({ snapshot }: { snapshot: HonestVisibilitySnapshot }) {
  const { metrics, sov, ratesReliable } = snapshot;
  const tiles = [
    { label: "Mention Rate", value: metrics.mentionRate, ci: metrics.mentionRateCI },
    { label: "Citation Rate", value: metrics.citationRate },
    { label: "Share of Voice", value: sov.brand?.shareOfVoice ?? metrics.shareOfVoice },
    { label: "Win Rate", value: metrics.winRate },
  ];

  return (
    <div className="grid md:grid-cols-4 gap-4">
      {tiles.map((m) => (
        <div key={m.label} className="bg-card border border-border rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-primary">
            {ratesReliable ? `${Math.round(m.value * 100)}%` : "—"}
          </div>
          <div className="text-sm text-muted-foreground">{m.label}</div>
          {ratesReliable && m.ci && (
            <div className="text-[10px] text-muted-foreground mt-1" title="95% Wilson confidence interval">
              95% CI {Math.round(m.ci.low * 100)}–{Math.round(m.ci.high * 100)}% · n={metrics.sampleSize}
            </div>
          )}
          {!ratesReliable && (
            <div className="text-[10px] text-muted-foreground mt-1">Not enough grounded probes</div>
          )}
        </div>
      ))}
    </div>
  );
}
