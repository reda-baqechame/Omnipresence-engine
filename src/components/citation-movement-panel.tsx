"use client";

import type { VisibilityRunDelta } from "@/lib/engines/visibility-delta";

interface CitationMovementPanelProps {
  delta: VisibilityRunDelta;
  competitors: string[];
}

export function CitationMovementPanel({ delta, competitors }: CitationMovementPanelProps) {
  const hasMovement =
    delta.gainedMentions > 0 ||
    delta.lostMentions > 0 ||
    delta.gainedCitations > 0 ||
    delta.lostCitations > 0;

  if (!hasMovement && Object.keys(delta.competitorGains).length === 0) {
    return null;
  }

  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Citation & Mention Movement</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Changes since previous scan
          {delta.previousRunDate && delta.currentRunDate && (
            <> ({new Date(delta.previousRunDate).toLocaleDateString()} → {new Date(delta.currentRunDate).toLocaleDateString()})</>
          )}
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <MovementCard label="Mentions gained" value={delta.gainedMentions} positive />
        <MovementCard label="Mentions lost" value={delta.lostMentions} positive={false} />
        <MovementCard label="Citations gained" value={delta.gainedCitations} positive />
        <MovementCard label="Citations lost" value={delta.lostCitations} positive={false} />
      </div>

      {competitors.length > 0 && (
        <div>
          <h3 className="font-medium mb-3">Competitor Movement</h3>
          <div className="grid md:grid-cols-2 gap-3">
            {competitors.slice(0, 5).map((comp) => {
              const gained = delta.competitorGains[comp] || 0;
              const lost = delta.competitorLosses[comp] || 0;
              if (gained === 0 && lost === 0) return null;
              return (
                <div key={comp} className="bg-secondary rounded-lg px-4 py-3 text-sm">
                  <div className="font-medium">{comp}</div>
                  <div className="text-muted-foreground mt-1">
                    {gained > 0 && <span className="text-red-400">+{gained} prompts gained</span>}
                    {gained > 0 && lost > 0 && " · "}
                    {lost > 0 && <span className="text-green-400">-{lost} prompts lost</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {delta.movements.length > 0 && (
        <div>
          <h3 className="font-medium mb-3">Recent Prompt Changes</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {delta.movements.map((m, i) => (
              <div key={i} className="flex items-start gap-3 text-sm bg-secondary/50 rounded-lg px-3 py-2">
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${movementColor(m.type)}`}>
                  {movementLabel(m.type)}
                </span>
                <div>
                  <div className="text-muted-foreground capitalize">{m.engine.replace(/_/g, " ")}</div>
                  <div className="line-clamp-2">{m.promptText}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MovementCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: number;
  positive: boolean;
}) {
  return (
    <div className="bg-secondary rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${value > 0 ? (positive ? "text-green-400" : "text-red-400") : "text-muted-foreground"}`}>
        {positive ? "+" : "-"}{value}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function movementLabel(type: string) {
  return type.replace(/_/g, " ");
}

function movementColor(type: string) {
  if (type.includes("gained")) return "bg-green-500/20 text-green-400";
  return "bg-red-500/20 text-red-400";
}
