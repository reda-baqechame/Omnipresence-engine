"use client";

import { useEffect, useState } from "react";
import { PanelError } from "@/components/panel-states";

interface Spoke {
  title: string;
  keyword: string;
  intent: string;
  buyer_stage: string;
  page_type: string;
}
interface Hub {
  hub: string;
  intent: string;
  page_type: string;
  spokes: Spoke[];
}
interface Brief {
  title: string;
  target_keyword: string;
  search_intent: string;
  word_count: number;
  outline: { heading: string; points: string[] }[];
  must_cover_entities: string[];
  faqs: string[];
  internal_link_targets: string[];
}

const STAGE_STYLE: Record<string, string> = {
  awareness: "bg-blue-500/15 text-blue-400",
  consideration: "bg-yellow-500/15 text-yellow-400",
  decision: "bg-green-500/15 text-green-400",
};

export function TopicalPanel({ projectId }: { projectId: string }) {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState("");
  const [reason, setReason] = useState("");
  const [briefKeyword, setBriefKeyword] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefMsg, setBriefMsg] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/topical?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.map?.hubs) setHubs(d.map.hubs);
      })
      .catch(() => setLoadError("Couldn't load the topical map. Check your connection and reload."));
  }, [projectId]);

  async function buildMap() {
    setLoading("map");
    setReason("");
    const res = await fetch("/api/topical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "build_map" }),
    });
    const d = await res.json();
    if (d.available && d.map?.hubs) setHubs(d.map.hubs);
    else setReason(d.reason || "Could not build map");
    setLoading("");
  }

  async function makeBrief(kw?: string) {
    const keyword = kw || briefKeyword;
    if (!keyword.trim()) return;
    setLoading("brief");
    setBriefMsg("");
    const res = await fetch("/api/topical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "brief", keyword }),
    });
    const d = await res.json();
    if (d.available && d.brief) {
      setBrief(d.brief);
      setBriefMsg("Brief created and added to Tasks.");
    } else {
      setBriefMsg(d.reason || "Could not generate brief");
    }
    setLoading("");
  }

  return (
    <div className="space-y-6">
      {loadError && <PanelError title="Topical map unavailable" message={loadError} />}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Topical map (hub & spoke)</h3>
          <button type="button" onClick={buildMap} disabled={loading === "map"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "map" ? "Building…" : "Build topical map"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Clusters your keyword universe into pillars and supporting articles with intent and buyer stage.
        </p>
        {reason && <p className="text-sm text-yellow-400">{reason}</p>}
        {hubs.length > 0 && (
          <div className="space-y-4">
            {hubs.map((h) => (
              <div key={h.hub} className="border border-border/50 rounded-lg p-3">
                <div className="font-medium">
                  {h.hub} <span className="text-xs text-muted-foreground">({h.page_type} · {h.intent})</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {h.spokes.map((s) => (
                    <li key={s.keyword} className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => makeBrief(s.keyword)} className="text-left hover:text-primary truncate">
                        {s.title}
                      </button>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${STAGE_STYLE[s.buyer_stage] || "bg-muted text-muted-foreground"}`}>{s.buyer_stage}</span>
                        <span className="text-xs text-muted-foreground">{s.page_type}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">Content brief generator</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Generate a SERP-informed brief for any keyword. Briefs are saved as tracked tasks.
        </p>
        <div className="flex flex-wrap gap-2">
          <input value={briefKeyword} onChange={(e) => setBriefKeyword(e.target.value)} placeholder="Keyword (or click a spoke above)" className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={() => makeBrief()} disabled={loading === "brief" || !briefKeyword.trim()} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            {loading === "brief" ? "Generating…" : "Generate brief"}
          </button>
        </div>
        {briefMsg && <p className="text-xs text-muted-foreground mt-2">{briefMsg}</p>}
        {brief && (
          <div className="mt-4 text-sm space-y-3">
            <div className="font-medium">{brief.title} <span className="text-xs text-muted-foreground">(~{brief.word_count} words · {brief.search_intent})</span></div>
            <div>
              <div className="font-medium mb-1">Outline</div>
              <ul className="space-y-1.5">
                {brief.outline.map((o) => (
                  <li key={o.heading}>
                    <span className="font-medium">{o.heading}</span>
                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                      {o.points.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
            {brief.must_cover_entities.length > 0 && (
              <div><span className="font-medium">Entities to cover:</span> <span className="text-muted-foreground">{brief.must_cover_entities.join(", ")}</span></div>
            )}
            {brief.faqs.length > 0 && (
              <div>
                <div className="font-medium mb-1">FAQs</div>
                <ul className="list-disc list-inside text-muted-foreground">
                  {brief.faqs.map((f) => <li key={f}>{f}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
