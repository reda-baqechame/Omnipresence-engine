"use client";

import { useEffect, useState } from "react";
import { PanelError } from "@/components/panel-states";

interface TrendItem {
  title: string;
  traffic?: string;
  viralScore: number;
}

interface TrendsPanelProps {
  projectId: string;
  industry?: string;
}

interface RisingTopic {
  topic: string;
  source: string;
  momentum: number;
  communityHits: number;
  createNow: boolean;
  intent: string;
}

export function TrendsPanel({ projectId, industry = "" }: TrendsPanelProps) {
  const [trends, setTrends] = useState<TrendItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  const [seed, setSeed] = useState(industry);
  const [rising, setRising] = useState<RisingTopic[]>([]);
  const [seasonality, setSeasonality] = useState<{ peakMonths: string[]; lowMonths: string[] } | null>(null);
  const [risingLoading, setRisingLoading] = useState(false);
  const [risingMsg, setRisingMsg] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ geo: "US" });
    if (industry) params.set("industry", industry);
    fetch(`/api/trends?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (active) setTrends(data.trends || []);
      })
      .catch(() => {
        if (active) setLoadError("Couldn't load trend data. Check your connection and reload.");
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

  async function discoverRising(queueContent = false) {
    setRisingLoading(true);
    setRisingMsg("");
    const res = await fetch("/api/demand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "rising", seed, geo: "US", queueContent }),
    });
    const data = await res.json();
    if (data.available) {
      setRising(data.rising || []);
      setSeasonality(data.seasonality?.available ? data.seasonality : null);
      if (queueContent) setRisingMsg(`Queued ${data.queued || 0} briefs from rising topics.`);
    } else {
      setRisingMsg("No rising-demand data available right now (Trends may be rate-limited).");
    }
    setRisingLoading(false);
  }

  return (
    <div className="space-y-6">
      {loadError && <PanelError title="Trend data unavailable" message={loadError} />}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-1">Rising demand discovery</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Fuses Google Trends momentum, autocomplete, and Reddit/HN velocity to catch rising topics before competitors — with seasonality.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="Seed topic or industry"
            className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => discoverRising(false)} disabled={risingLoading || !seed.trim()} className="border border-border px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            {risingLoading ? "Scanning…" : "Discover"}
          </button>
          <button type="button" onClick={() => discoverRising(true)} disabled={risingLoading || !seed.trim()} className="bg-primary text-primary-foreground px-3 py-2 rounded-lg text-sm disabled:opacity-50">
            Discover + queue briefs
          </button>
        </div>
        {risingMsg && <p className="text-sm text-muted-foreground mb-2">{risingMsg}</p>}
        {seasonality && (
          <p className="text-xs text-muted-foreground mb-2">
            Seasonality — peaks: {seasonality.peakMonths.join(", ") || "—"} · lows: {seasonality.lowMonths.join(", ") || "—"}
          </p>
        )}
        {rising.length > 0 && (
          <ul className="text-sm space-y-1.5 max-h-72 overflow-y-auto">
            {rising.map((t) => (
              <li key={t.topic} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1">
                <span className="truncate">
                  {t.topic}
                  <span className="text-xs text-muted-foreground ml-2">{t.intent} · {t.source}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {t.createNow && <span className="rounded px-1.5 py-0.5 text-[10px] bg-green-500/15 text-green-400">CREATE NOW</span>}
                  <span className="text-xs text-muted-foreground">m{t.momentum} · {t.communityHits} comm</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
          !loadError && <p className="text-sm text-muted-foreground">Loading trends or no matches for your industry.</p>
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
