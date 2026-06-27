"use client";

import { useEffect, useState } from "react";

interface Summary {
  available: boolean;
  reason?: string;
  period?: { start: string; end: string };
  totals?: {
    organicTraffic: number;
    aiReferralTraffic: number;
    socialClicks: number;
    directoryReferrals: number;
    searchClicks: number;
    leads: number;
    revenue: number;
    paidAdsEquivalent: number;
  };
  deltas?: Record<string, { value: number; change: number; changePercent: number }>;
  channelMix?: Array<{ channel: string; value: number; percent: number }>;
  isEstimated?: boolean;
}
interface UxEmbed {
  tool: string;
  embedUrl?: string;
  note: string;
}
interface LandingPage {
  landingPage: string;
  sessions: number;
  conversions: number;
  revenue: number;
}

function Stat({ label, value, delta, prefix = "" }: { label: string; value: number; delta?: { changePercent: number }; prefix?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{prefix}{value.toLocaleString()}</div>
      {delta && (
        <div className={`text-xs mt-1 ${delta.changePercent >= 0 ? "text-green-400" : "text-red-400"}`}>
          {delta.changePercent >= 0 ? "▲" : "▼"} {Math.abs(delta.changePercent)}% MoM
        </div>
      )}
    </div>
  );
}

export function RoiCommandPanel({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [uxEmbeds, setUxEmbeds] = useState<UxEmbed[]>([]);
  const [landingPages, setLandingPages] = useState<LandingPage[]>([]);
  const [lpMsg, setLpMsg] = useState("");
  const [loading, setLoading] = useState("");
  const [clarityId, setClarityId] = useState("");
  const [hotjarId, setHotjarId] = useState("");

  useEffect(() => {
    fetch(`/api/roi?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setSummary(d.summary);
        setUxEmbeds(d.uxEmbeds || []);
      });
  }, [projectId]);

  async function loadLandingPages() {
    setLoading("lp");
    setLpMsg("");
    const res = await fetch("/api/roi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "landing_pages" }),
    });
    const d = await res.json();
    if (d.available) setLandingPages(d.landingPages || []);
    else setLpMsg(d.reason || "Unavailable");
    setLoading("");
  }

  async function saveUx() {
    setLoading("ux");
    await fetch("/api/roi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "save_ux", clarityProjectId: clarityId, hotjarSiteId: hotjarId }),
    });
    const res = await fetch(`/api/roi?projectId=${projectId}`);
    const d = await res.json();
    setUxEmbeds(d.uxEmbeds || []);
    setLoading("");
  }

  if (!summary) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!summary.available) {
    return <p className="text-sm text-yellow-400">{summary.reason}</p>;
  }

  const t = summary.totals!;
  const d = summary.deltas || {};

  return (
    <div className="space-y-6">
      {summary.period && (
        <p className="text-xs text-muted-foreground">
          Period {summary.period.start} → {summary.period.end}
          {summary.isEstimated ? " · some values estimated" : ""}
        </p>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label="Revenue" value={t.revenue} delta={d.revenue} prefix="$" />
        <Stat label="Leads" value={t.leads} delta={d.leads} />
        <Stat label="Paid-ad equivalent" value={t.paidAdsEquivalent} delta={d.paid_ads_equivalent} prefix="$" />
        <Stat label="Organic traffic" value={t.organicTraffic} delta={d.organic_traffic} />
        <Stat label="AI referrals" value={t.aiReferralTraffic} delta={d.ai_referral_traffic} />
        <Stat label="Social clicks" value={t.socialClicks} delta={d.social_clicks} />
        <Stat label="Directory referrals" value={t.directoryReferrals} delta={d.directory_referrals} />
        <Stat label="Search clicks" value={t.searchClicks} />
      </div>

      {summary.channelMix && summary.channelMix.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3">Channel mix</h3>
          <div className="space-y-2">
            {summary.channelMix.map((c) => (
              <div key={c.channel}>
                <div className="flex justify-between text-sm mb-0.5">
                  <span>{c.channel}</span>
                  <span className="text-muted-foreground">{c.value.toLocaleString()} ({c.percent}%)</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${c.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Revenue by landing page</h3>
          <button type="button" onClick={loadLandingPages} disabled={loading === "lp"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "lp" ? "Loading…" : "Load from GA4"}
          </button>
        </div>
        {lpMsg && <p className="text-sm text-yellow-400">{lpMsg}</p>}
        {landingPages.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Landing page</th>
                <th className="py-1 text-right">Sessions</th>
                <th className="py-1 text-right">Conv.</th>
                <th className="py-1 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {landingPages.map((p) => (
                <tr key={p.landingPage} className="border-t border-border/40">
                  <td className="py-1 truncate max-w-[280px]">{p.landingPage}</td>
                  <td className="py-1 text-right">{p.sessions.toLocaleString()}</td>
                  <td className="py-1 text-right">{p.conversions.toLocaleString()}</td>
                  <td className="py-1 text-right">${p.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">UX layer (optional)</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Link Microsoft Clarity / Hotjar for heatmaps &amp; session recordings (read-only links).
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <input value={clarityId} onChange={(e) => setClarityId(e.target.value)} placeholder="Clarity project ID" className="flex-1 min-w-[160px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <input value={hotjarId} onChange={(e) => setHotjarId(e.target.value)} placeholder="Hotjar site ID" className="flex-1 min-w-[160px] bg-background border border-input rounded-lg px-3 py-2 text-sm" />
          <button type="button" onClick={saveUx} disabled={loading === "ux"} className="border border-border px-3 py-2 rounded-lg text-sm disabled:opacity-50">Save</button>
        </div>
        {uxEmbeds.length > 0 && (
          <ul className="text-sm space-y-1">
            {uxEmbeds.map((e) => (
              <li key={e.tool}>
                <a href={e.embedUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{e.tool}</a>
                <span className="text-muted-foreground ml-2">{e.note}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
