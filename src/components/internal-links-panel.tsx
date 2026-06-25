"use client";

import { useState } from "react";

interface LinkOpportunity {
  id: string;
  source_url: string;
  target_url: string;
  anchor_suggestion: string;
  relevance_score: number;
  status: string;
}

interface InternalLinksPanelProps {
  projectId: string;
}

export function InternalLinksPanel({ projectId }: InternalLinksPanelProps) {
  const [items, setItems] = useState<LinkOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const res = await fetch(`/api/internal-links?projectId=${projectId}`);
    const data = await res.json();
    setItems(data.opportunities || []);
  }

  async function analyze() {
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/internal-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const data = await res.json();
    setMessage(`Found ${data.found || 0} opportunities (${data.pagesCrawled || 0} pages crawled)`);
    await load();
    setLoading(false);
  }

  async function setStatus(id: string, status: string, apply = false) {
    await fetch("/api/internal-links", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, apply }),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Internal Linking</h3>
          <p className="text-sm text-muted-foreground">
            Weekly cron scans your site. Approve links, then apply to WordPress when connected.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="border border-border px-4 py-2 rounded-lg text-sm">
            Refresh
          </button>
          <button
            type="button"
            onClick={analyze}
            disabled={loading}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Run analysis"}
          </button>
        </div>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No opportunities yet. Run analysis or wait for Tuesday cron.</p>
        ) : (
          items.map((o) => (
            <div key={o.id} className="bg-card border border-border rounded-xl p-4 text-sm">
              <div className="flex justify-between gap-2 mb-2 flex-wrap">
                <span className="font-medium">Score: {o.relevance_score}/100</span>
                <span className="text-xs uppercase text-muted-foreground">{o.status}</span>
              </div>
              <p className="text-muted-foreground truncate">From: {o.source_url}</p>
              <p className="truncate">To: {o.target_url}</p>
              <p className="mt-1">Anchor: &quot;{o.anchor_suggestion}&quot;</p>
              {o.status === "identified" && (
                <div className="flex gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setStatus(o.id, "approved")}
                    className="text-xs border border-border px-2 py-1 rounded"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatus(o.id, "rejected")}
                    className="text-xs text-muted-foreground px-2 py-1"
                  >
                    Reject
                  </button>
                </div>
              )}
              {o.status === "approved" && (
                <button
                  type="button"
                  onClick={() => setStatus(o.id, "applied", true)}
                  className="mt-2 text-xs bg-primary text-primary-foreground px-2 py-1 rounded"
                >
                  Apply to WordPress
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
