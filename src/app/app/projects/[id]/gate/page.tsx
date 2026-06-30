import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { buildPresenceGateScore } from "@/lib/scoring/presence-gate-builder";

export const dynamic = "force-dynamic";

function scoreColor(score: number, available: boolean): string {
  if (!available) return "text-muted-foreground";
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

export default async function PresenceGatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const gate = await buildPresenceGateScore(supabase, id);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Presence Gate</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The weakest-link readiness gate. Marketing superlatives and the outcome guarantee unlock only when every
          critical gate is measurable and the strict (unavailable-counts-as-zero) score clears the bar — so we never
          over-claim on partial data.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Strict score</div>
          <div className={`text-4xl font-bold mt-1 ${scoreColor(gate.score, true)}`}>{Math.round(gate.score)}</div>
          <div className="text-xs text-muted-foreground mt-1">Unavailable gates count as 0 (weakest link)</div>
        </div>
        <div className="rounded-xl border border-border p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Available score</div>
          <div className={`text-4xl font-bold mt-1 ${scoreColor(gate.availableScore, true)}`}>
            {Math.round(gate.availableScore)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Across gates we could evaluate</div>
        </div>
        <div className="rounded-xl border border-border p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Guarantee eligible</div>
          <div className={`text-4xl font-bold mt-1 ${gate.guaranteeEligible ? "text-green-400" : "text-red-400"}`}>
            {gate.guaranteeEligible ? "Yes" : "No"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Coverage {Math.round(gate.coverage * 100)}%
            {gate.limitingGate ? ` · limited by ${gate.limitingGate}` : ""}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="px-4 py-2.5 font-medium">Gate</th>
              <th className="px-4 py-2.5 font-medium">Score</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {gate.gates.map((g) => (
              <tr key={g.gate} className="border-t border-border">
                <td className="px-4 py-2.5 font-medium capitalize">{g.gate.replace(/_/g, " ")}</td>
                <td className={`px-4 py-2.5 font-semibold ${scoreColor(g.score, g.available)}`}>
                  {g.available ? Math.round(g.score) : "—"}
                </td>
                <td className="px-4 py-2.5">
                  {g.available ? (
                    g.gate === gate.limitingGate ? (
                      <span className="text-orange-400">Limiting gate</span>
                    ) : (
                      <span className="text-green-400">Measured</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">Unavailable</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{g.detail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
