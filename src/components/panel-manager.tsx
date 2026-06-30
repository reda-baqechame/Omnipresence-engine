"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PanelSummary {
  id: string;
  name: string;
  description: string | null;
  geos: string[];
  personas: string[];
  engines: string[];
  runs_per_prompt: number;
  is_active: boolean;
  last_run_at: string | null;
  member_count: number;
}

interface PanelManagerProps {
  projectId: string;
  panels: PanelSummary[];
}

const ENGINE_OPTIONS = ["chatgpt", "claude", "gemini", "perplexity", "bing_copilot", "google_ai_overview", "google_organic"];

export function PanelManager({ projectId, panels }: PanelManagerProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [prompts, setPrompts] = useState("");
  const [geos, setGeos] = useState("United States");
  const [personas, setPersonas] = useState("");
  const [engines, setEngines] = useState<string[]>(["chatgpt", "perplexity", "google_ai_overview"]);
  const [runs, setRuns] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function toggleEngine(e: string) {
    setEngines((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  async function createPanel() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/panels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name,
        geos: geos.split(",").map((s) => s.trim()).filter(Boolean),
        personas: personas.split(",").map((s) => s.trim()).filter(Boolean),
        engines,
        runsPerPrompt: runs,
        prompts: prompts.split("\n").map((s) => s.trim()).filter(Boolean),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setMsg(`Created panel with ${data.member_count} prompts`);
      setName("");
      setPrompts("");
      router.refresh();
    } else {
      setMsg(data.error || "Failed to create panel");
    }
  }

  async function runPanel(id: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/panels/${id}/run`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok ? `Panel run queued (${data.cells ?? "?"} cells)` : data.error || "Run failed");
    if (res.ok) router.refresh();
  }

  async function deletePanel(id: string) {
    if (!confirm("Delete this panel?")) return;
    setBusy(true);
    await fetch(`/api/panels/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <h3 className="font-semibold">New Prompt Panel</h3>
        <p className="text-sm text-muted-foreground">
          A panel measures every prompt across engines × geos × personas × runs. Repeated measurement is what makes the numbers credible.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Panel name (e.g. Best CRM cluster)"
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
        />
        <textarea
          value={prompts}
          onChange={(e) => setPrompts(e.target.value)}
          placeholder={"One prompt per line:\nbest CRM for small business\nHubSpot alternatives\ntop CRM for agencies"}
          rows={4}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm font-mono"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="text-muted-foreground">Geos (comma-separated)</span>
            <input value={geos} onChange={(e) => setGeos(e.target.value)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-sm space-y-1">
            <span className="text-muted-foreground">Personas (comma-separated, optional)</span>
            <input value={personas} onChange={(e) => setPersonas(e.target.value)} placeholder="founder, marketer, buyer" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {ENGINE_OPTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => toggleEngine(e)}
              className={`text-xs px-2 py-1 rounded-full border ${engines.includes(e) ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground"}`}
            >
              {e}
            </button>
          ))}
        </div>
        <label className="text-sm flex items-center gap-2">
          <span className="text-muted-foreground">Runs per prompt</span>
          <input type="number" min={1} max={10} value={runs} onChange={(e) => setRuns(Number(e.target.value))} className="w-20 bg-background border border-border rounded-lg px-2 py-1 text-sm" />
        </label>
        <div className="flex items-center gap-3">
          <button onClick={createPanel} disabled={busy || !name.trim()} className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Working…" : "Create panel"}
          </button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </div>

      <div className="space-y-2">
        {panels.length === 0 && <p className="text-sm text-muted-foreground">No panels yet. Create one above.</p>}
        {panels.map((p) => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.member_count} prompts · {p.engines.length} engines · {p.geos.length || 1} geos · {p.personas.length || 1} personas · {p.runs_per_prompt}× runs
                {p.last_run_at ? ` · last run ${new Date(p.last_run_at).toLocaleDateString()}` : " · never run"}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => runPanel(p.id)} disabled={busy} className="bg-secondary text-secondary-foreground rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">
                Run
              </button>
              <button onClick={() => deletePanel(p.id)} disabled={busy} className="text-destructive text-sm px-2 py-1.5">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
