"use client";

import { useEffect, useState } from "react";

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

  async function load() {
    const res = await fetch(`/api/internal-links?projectId=${projectId}`);
    const data = await res.json();
    setItems(data.opportunities || []);
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/internal-links?projectId=${projectId}`)
      .then((res) => res.json())
      .then((data) => {
        if (active) setItems(data.opportunities || []);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  async function analyze() {
    setLoading(true);
    await fetch("/api/internal-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    await load();
    setLoading(false);
  }

  async function setStatus(id: string, status: string) {
    await fetch("/api/internal-links", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Internal Linking</h3>
          <p className="text-sm text-muted-foreground">
            Crawl your site and find high-impact internal link opportunities (PageRank-based).
          </p>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {loading ? "Analyzing..." : "Run analysis"}
        </button>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No opportunities yet. Run analysis to discover links.</p>
        ) : (
          items.map((o) => (
            <div key={o.id} className="bg-card border border-border rounded-xl p-4 text-sm">
              <div className="flex justify-between gap-2 mb-2">
                <span className="font-medium">Score: {o.relevance_score}/100</span>
                <select
                  value={o.status}
                  onChange={(e) => setStatus(o.id, e.target.value)}
                  className="bg-background border border-input rounded text-xs px-2 py-1"
                >
                  <option value="identified">Identified</option>
                  <option value="approved">Approved</option>
                  <option value="applied">Applied</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <p className="text-muted-foreground truncate">From: {o.source_url}</p>
              <p className="truncate">To: {o.target_url}</p>
              <p className="mt-1">Anchor: &quot;{o.anchor_suggestion}&quot;</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
