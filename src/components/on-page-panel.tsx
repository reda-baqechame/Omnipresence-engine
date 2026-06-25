"use client";

import { useState } from "react";

interface OpsFix {
  id: string;
  title: string;
  status: string;
  payload: { proposed?: string; field?: string; url?: string };
}

export function OnPagePanel({ projectId }: { projectId: string }) {
  const [fixes, setFixes] = useState<OpsFix[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch(`/api/on-page?projectId=${projectId}`);
    const data = await res.json();
    setFixes(data.fixes || []);
  }

  async function runScan() {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/on-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    setMessage(`Proposed ${data.proposed || 0} fixes`);
    await load();
    setLoading(false);
  }

  async function approve(queueId: string, apply: boolean) {
    await fetch("/api/on-page", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queueId, apply }),
    });
    await load();
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">On-Page Automation</h3>
          <p className="text-sm text-muted-foreground">6 agents scan title, meta, schema, freshness — approve to apply via WordPress.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" onClick={load} className="border border-border px-3 py-2 rounded text-sm">
            Refresh
          </button>
          <button
            type="button"
            onClick={runScan}
            disabled={loading}
            className="bg-primary text-primary-foreground px-3 py-2 rounded text-sm"
          >
            {loading ? "Scanning..." : "Run scan"}
          </button>
        </div>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <ul className="space-y-2 max-h-64 overflow-y-auto">
        {fixes.slice(0, 12).map((f) => (
          <li key={f.id} className="border border-border rounded p-2 text-sm">
            <p className="font-medium truncate">{f.title}</p>
            {f.payload.proposed && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{f.payload.proposed}</p>
            )}
            {f.status === "pending" && (
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => approve(f.id, false)} className="text-xs border border-border px-2 py-1 rounded">
                  Approve
                </button>
                <button type="button" onClick={() => approve(f.id, true)} className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
                  Approve & apply
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
