import type { SovComparison } from "@/lib/engines/share-of-voice";

function pts(delta: number): string {
  const v = Math.round(delta * 100);
  return `${v >= 0 ? "+" : ""}${v} pts`;
}

/**
 * "Biggest movers" run-over-run callout — who gained and lost the most
 * prominence-weighted Share of Voice since the previous scan.
 */
export function SovMovers({ comparison }: { comparison: SovComparison }) {
  if (!comparison.hasComparison) return null;

  const { biggestGainer, biggestLoser, brandDelta } = comparison;
  if (!biggestGainer && !biggestLoser && !brandDelta) return null;

  const card = (
    title: string,
    mover: { name: string; isBrand: boolean; current: number; delta: number } | null,
    tone: "up" | "down" | "neutral"
  ) => {
    if (!mover) return null;
    const color =
      tone === "up" ? "text-green-400" : tone === "down" ? "text-red-400" : "text-primary";
    return (
      <div className="border border-border rounded-lg p-4">
        <div className="text-xs text-muted-foreground mb-1">{title}</div>
        <div className="text-sm font-semibold truncate" title={mover.name}>
          {mover.name}{mover.isBrand ? " (you)" : ""}
        </div>
        <div className={`text-lg font-bold ${color}`}>{pts(mover.delta)}</div>
        <div className="text-xs text-muted-foreground">now {Math.round(mover.current * 100)}% share</div>
      </div>
    );
  };

  const brandTone = brandDelta ? (brandDelta.delta > 0 ? "up" : brandDelta.delta < 0 ? "down" : "neutral") : "neutral";

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-1">Biggest Movers</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Prominence-weighted Share of Voice change since your previous scan.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {card("Your change", brandDelta, brandTone)}
        {card("Top gainer", biggestGainer, "up")}
        {card("Biggest drop", biggestLoser, "down")}
      </div>
    </div>
  );
}
