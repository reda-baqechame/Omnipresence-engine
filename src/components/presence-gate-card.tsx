import Link from "next/link";
import { getGateLabel } from "@/lib/scoring/presence-gate";
import type { MinGateResult } from "@/lib/scoring/presence-gate";

interface PresenceGateCardProps {
  projectId: string;
  gate: MinGateResult;
}

/** Command-center summary: weakest-link gate + link to fix the limiting capability. */
export function PresenceGateCard({ projectId, gate }: PresenceGateCardProps) {
  const label = getGateLabel(gate.score);
  const limiting = gate.limitingGate?.replace(/_/g, " ") ?? "none";

  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Presence Gate</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Minimum-gate readiness — you are only as proven as your weakest critical capability.
            {gate.ready
              ? " All gates ≥60: outcome guarantee permitted."
              : ` Limiting gate: ${limiting}.`}
          </p>
          {!gate.ready && gate.limitingGate && (
            <Link
              href={`/app/projects/${projectId}/gate`}
              className="inline-block mt-2 text-sm text-primary hover:underline"
            >
              View all gates →
            </Link>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-3xl font-bold ${label.color}`}>{Math.round(gate.score)}</div>
          <div className={`text-xs font-medium ${label.color}`}>{label.label}</div>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-2 rounded-full ${gate.ready ? "bg-green-500" : "bg-amber-500"}`}
          style={{ width: `${Math.min(100, gate.score)}%` }}
        />
      </div>
    </div>
  );
}
