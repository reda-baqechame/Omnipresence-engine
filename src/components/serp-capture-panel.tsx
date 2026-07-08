"use client";

import { useEffect, useState } from "react";
import { PanelError } from "@/components/panel-states";

interface Opp {
  keyword: string;
  feature: string;
  current_position: number | null;
  recommended_format: string;
  owned: boolean;
}
interface Block {
  format: string;
  question_heading: string;
  snippet_html: string;
  plain_answer: string;
}

export function SerpCapturePanel({ projectId }: { projectId: string }) {
  const [opps, setOpps] = useState<Opp[]>([]);
  const [loading, setLoading] = useState("");
  const [msg, setMsg] = useState("");
  const [block, setBlock] = useState<Block | null>(null);
  const [decayMsg, setDecayMsg] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/serp-capture?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setOpps(d.opportunities || []))
      .catch(() => setLoadError("Couldn't load SERP capture data. Check your connection and reload."));
  }, [projectId]);

  async function detect() {
    setLoading("detect");
    setMsg("");
    const res = await fetch("/api/serp-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "detect" }),
    });
    const d = await res.json();
    setOpps(d.opportunities || []);
    setMsg(`${d.found || 0} snippet / PAA opportunities found from tracked keywords.`);
    setLoading("");
  }

  async function makeBlock(keyword: string, format: string) {
    setLoading("block:" + keyword);
    setBlock(null);
    const res = await fetch("/api/serp-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "snippet_block", keyword, format }),
    });
    const d = await res.json();
    if (d.available && d.block) setBlock(d.block);
    setLoading("");
  }

  async function decayTasks() {
    setLoading("decay");
    setDecayMsg("");
    const res = await fetch("/api/serp-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "decay_tasks" }),
    });
    const d = await res.json();
    setDecayMsg(
      d.available
        ? `${d.decaying} decaying pages detected; ${d.tasksCreated} refresh tasks created (see Tasks tab).`
        : d.reason || "Unavailable"
    );
    setLoading("");
  }

  return (
    <div className="space-y-6">
      {loadError && <PanelError title="SERP capture data unavailable" message={loadError} />}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Featured snippet &amp; PAA capture</h3>
          <button type="button" onClick={detect} disabled={loading === "detect"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "detect" ? "Scanning…" : "Detect opportunities"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Finds tracked keywords where Google shows a snippet/PAA box you don&apos;t own, and generates a block formatted to win it.
        </p>
        {msg && <p className="text-sm text-muted-foreground mb-2">{msg}</p>}
        {opps.length > 0 && (
          <ul className="text-sm space-y-1.5 max-h-72 overflow-y-auto">
            {opps.map((o) => (
              <li key={o.keyword + o.feature} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1">
                <span className="truncate">
                  {o.keyword}
                  <span className="text-xs text-muted-foreground ml-2">{o.feature} · pos {o.current_position ?? "—"}</span>
                </span>
                {o.owned ? (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-green-500/15 text-green-400">OWNED</span>
                ) : (
                  <button type="button" onClick={() => makeBlock(o.keyword, o.recommended_format)} disabled={loading.startsWith("block:")} className="shrink-0 text-xs border border-border px-2 py-0.5 rounded disabled:opacity-50">
                    Win it ({o.recommended_format})
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {block && (
          <div className="mt-4 border border-border/50 rounded-lg p-3 text-sm">
            <div className="font-medium">{block.question_heading}</div>
            <p className="text-muted-foreground mt-1">{block.plain_answer}</p>
            <pre className="mt-2 bg-background border border-border rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">{block.snippet_html}</pre>
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Content decay → refresh tasks</h3>
          <button type="button" onClick={decayTasks} disabled={loading === "decay"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "decay" ? "Analyzing…" : "Detect decay"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Compares the last 28 days vs the prior 28 in Search Console; pages losing impressions become tracked refresh tasks.
        </p>
        {decayMsg && <p className="text-sm text-muted-foreground mt-2">{decayMsg}</p>}
      </div>
    </div>
  );
}
