"use client";

import { useEffect, useState } from "react";

interface TrendItem {
  title: string;
  traffic?: string;
  viralScore: number;
}

interface TrendsPanelProps {
  projectId: string;
  industry?: string;
}

export function TrendsPanel({ projectId, industry = "" }: TrendsPanelProps) {
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ geo: "US" });
    if (industry) params.set("industry", industry);
    fetch(`/api/trends?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (active) setTrends(data.trends || []);
      });
    return () => {
      active = false;
    };
  }, [industry]);

  async function queueBriefs() {
    setLoading(true);
    setQueued(null);
    const res = await fetch("/api/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, geo: "US", queueContent: true }),
    });
    const data = await res.json();
    setTrends(data.trends || []);
    setQueued(data.queued ?? 0);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Trend Discovery</h3>
          <p className="text-sm text-muted-foreground">
            Google Trends RSS matched to your industry. Queue content briefs from rising topics.
          </p>
        </div>
        <button
          type="button"
          onClick={queueBriefs}
          disabled={loading}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50 shrink-0"
        >
          {loading ? "Queuing..." : "Queue top briefs"}
        </button>
      </div>

      {queued !== null && (
        <p className="text-sm text-muted-foreground">Queued {queued} content brief(s) in Content tab.</p>
      )}

      <div className="space-y-3">
        {trends.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading trends or no matches for your industry.</p>
        ) : (
          trends.map((t) => (
            <div key={t.title} className="bg-card border border-border rounded-xl p-4 text-sm">
              <div className="flex justify-between gap-2 mb-1">
                <span className="font-medium">{t.title}</span>
                <span className="text-muted-foreground">Viral: {t.viralScore}/100</span>
              </div>
              {t.traffic && <p className="text-muted-foreground">Traffic: {t.traffic}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
