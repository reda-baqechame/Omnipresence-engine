"use client";

import { useState } from "react";

interface VideoOpportunity {
  keyword: string;
  videoRanksOnGoogle: boolean;
  brandHasVideo: boolean;
  competitorHasVideo: boolean;
  topVideo?: { title: string; url: string; channel: string };
  score: number;
}
interface VideoSeoResult {
  available: boolean;
  reason?: string;
  youtubeConnected: boolean;
  opportunities: VideoOpportunity[];
}

export function VideoSeoPanel({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VideoSeoResult | null>(null);

  async function run() {
    setLoading(true);
    const res = await fetch("/api/video-seo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    setResult(await res.json());
    setLoading(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Video SEO opportunities</h3>
          <p className="text-xs text-muted-foreground">Keywords where video ranks on Google but you have no video — top-of-SERP wins.</p>
        </div>
        <button type="button" onClick={run} disabled={loading} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
          {loading ? "Analyzing…" : "Find video gaps"}
        </button>
      </div>
      {result && !result.available && <p className="text-sm text-yellow-400">{result.reason}</p>}
      {result?.available && (
        <>
          {!result.youtubeConnected && (
            <p className="text-xs text-muted-foreground">Tip: enable YouTube Data API on your Google Cloud key (<code>PAGESPEED_API_KEY</code>) for brand vs competitor channel coverage.</p>
          )}
          {result.opportunities.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {result.opportunities.map((o) => (
                <li key={o.keyword} className="border border-border/50 rounded-lg p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{o.keyword}</span>
                    <span className={o.score >= 70 ? "text-green-400" : "text-yellow-400"}>{o.score}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {o.videoRanksOnGoogle ? "Video ranks on Google" : "No video in SERP"}
                    {o.competitorHasVideo ? " · competitor has a video" : ""}
                    {o.brandHasVideo ? " · you have a video" : " · you have none"}
                  </p>
                  {o.topVideo && (
                    <a href={o.topVideo.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      Top: {o.topVideo.title} ({o.topVideo.channel})
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No video opportunities found for your current keywords.</p>
          )}
        </>
      )}
    </div>
  );
}
