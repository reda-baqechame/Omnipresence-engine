import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProject } from "@/lib/projects";
import { buildTrafficIntelligence, type TrafficProvenance } from "@/lib/engines/traffic-intelligence";

export const dynamic = "force-dynamic";

const PROVENANCE_BADGE: Record<TrafficProvenance, { label: string; cls: string }> = {
  first_party_measured: { label: "First-party measured", cls: "bg-green-500/15 text-green-400" },
  panel_observed: { label: "Panel observed", cls: "bg-blue-500/15 text-blue-400" },
  model_estimated: { label: "Model-estimated (relative)", cls: "bg-yellow-500/15 text-yellow-400" },
  unavailable: { label: "Unavailable", cls: "bg-muted text-muted-foreground" },
};

function Badge({ p }: { p: TrafficProvenance }) {
  const b = PROVENANCE_BADGE[p];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${b.cls}`}>{b.label}</span>;
}

export default async function TrafficPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const intel = await buildTrafficIntelligence(supabase, id, project.domain, project.competitors || []);
  const maxIndex = Math.max(1, ...intel.competitors.map((c) => c.trafficIndex));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Traffic Intelligence</h2>
        <p className="text-sm text-muted-foreground mt-1">{intel.note}</p>
      </div>

      {/* Layer 1 — first-party measured */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Layer 1 · Your measured traffic</h3>
          <Badge p={intel.firstParty.provenance} />
        </div>
        {!intel.firstParty.available ? (
          <p className="mt-3 text-sm text-muted-foreground">{intel.firstParty.reason}</p>
        ) : (
          <>
            {intel.firstParty.period && (
              <p className="text-xs text-muted-foreground mt-1">
                Period {new Date(intel.firstParty.period.start).toLocaleDateString()} –{" "}
                {new Date(intel.firstParty.period.end).toLocaleDateString()}
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
              {intel.firstParty.channels.map((c) => (
                <div key={c.channel} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{c.channel}</p>
                  <p className="text-lg font-semibold mt-1">
                    {c.available ? c.value.toLocaleString() : <span className="text-muted-foreground">—</span>}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Total measured (healthy channels only): {intel.firstParty.totalMeasured.toLocaleString()}
              {typeof intel.firstParty.confidence === "number"
                ? ` · confidence ${Math.round(intel.firstParty.confidence * 100)}%`
                : ""}
            </p>
          </>
        )}
      </div>

      {/* Layer 2 — opt-in panel */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Layer 2 · Opt-in panel</h3>
          <Badge p={intel.panel.provenance} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{intel.panel.reason}</p>
      </div>

      {/* Layer 3 — model-estimated competitor view */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Layer 3 · Competitor view (relative index)</h3>
          <Badge p="model_estimated" />
        </div>
        <p className="text-xs text-muted-foreground mt-1 mb-3">
          Relative popularity index (0–100) from public signals — NOT visit counts. Use it to compare relative reach,
          never to quote absolute traffic.
        </p>
        <div className="space-y-2">
          {intel.competitors.map((c, i) => (
            <div key={c.domain} className="flex items-center gap-3 text-sm">
              <span className={`w-40 truncate shrink-0 ${i === 0 ? "font-semibold text-primary" : ""}`}>
                {c.domain}
                {i === 0 && <span className="ml-1.5 text-[10px] uppercase text-primary">You</span>}
              </span>
              <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                <div
                  className={i === 0 ? "h-2 bg-primary" : "h-2 bg-muted-foreground/40"}
                  style={{ width: `${Math.round((c.trafficIndex / maxIndex) * 100)}%` }}
                />
              </div>
              <span className="w-12 text-right tabular-nums">{c.available ? c.trafficIndex : "—"}</span>
              <span className="w-28 text-right text-xs text-muted-foreground">
                {typeof c.globalRank === "number" ? `#${c.globalRank.toLocaleString()}` : c.signals.join(", ") || "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
