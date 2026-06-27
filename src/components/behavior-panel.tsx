"use client";

import { useEffect, useState } from "react";

interface BehaviorMetric {
  url: string;
  sessions: number;
  scroll_depth_pct: number | null;
  engagement_time_sec: number | null;
  dead_clicks: number;
  rage_clicks: number;
  quickbacks: number;
}
interface BehaviorIssue {
  url: string;
  kind: string;
  severity: string;
  sessions: number;
  metric: number;
  title: string;
  description: string;
}
interface BehaviorSummary {
  available: boolean;
  reason?: string;
  totalSessions: number;
  pagesAnalyzed: number;
  issues: BehaviorIssue[];
  conversionSignal?: number;
}

const SEV_STYLE: Record<string, string> = {
  high: "text-red-400",
  medium: "text-yellow-400",
  low: "text-muted-foreground",
};

export function BehaviorPanel({ projectId }: { projectId: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<BehaviorMetric[]>([]);
  const [summary, setSummary] = useState<BehaviorSummary | null>(null);
  const [loading, setLoading] = useState("");
  const [token, setToken] = useState("");
  const [clarityId, setClarityId] = useState("");

  useEffect(() => {
    fetch(`/api/behavior?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        setConnected(Boolean(d.connected));
        setMetrics(d.metrics || []);
      });
  }, [projectId]);

  async function connect() {
    if (!token.trim()) return;
    setLoading("connect");
    await fetch("/api/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        provider: "clarity",
        credentials: { token: token.trim(), clarityProjectId: clarityId.trim() },
        metadata: { clarityProjectId: clarityId.trim() },
      }),
    });
    setConnected(true);
    setToken("");
    setLoading("");
  }

  async function sync() {
    setLoading("sync");
    const res = await fetch("/api/behavior", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const d = (await res.json()) as BehaviorSummary;
    setSummary(d);
    if (d.available) {
      const refreshed = await fetch(`/api/behavior?projectId=${projectId}`).then((r) => r.json());
      setMetrics(refreshed.metrics || []);
    }
    setLoading("");
  }

  const snippet = clarityId
    ? `<script type="text/javascript">
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${clarityId.replace(/[^a-z0-9]/gi, "")}");
</script>`
    : "";

  return (
    <div className="space-y-6">
      {connected === false && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold">Connect Microsoft Clarity (free)</h3>
          <p className="text-sm text-muted-foreground">
            Create a free project at{" "}
            <a className="text-primary hover:underline" href="https://clarity.microsoft.com" target="_blank" rel="noopener noreferrer">clarity.microsoft.com</a>,
            then paste your project ID and a Data Export API token (Settings → Data Export).
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={clarityId} onChange={(e) => setClarityId(e.target.value)} placeholder="Clarity project ID" className="bg-background border border-border rounded-lg px-3 py-2 text-sm" />
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Data Export API token" type="password" className="bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          {snippet && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Paste this tracking snippet into your site&apos;s &lt;head&gt;:</p>
              <pre className="bg-background border border-border rounded-lg p-2 text-xs overflow-x-auto whitespace-pre-wrap">{snippet}</pre>
            </div>
          )}
          <button type="button" onClick={connect} disabled={loading === "connect" || !token.trim()} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "connect" ? "Saving…" : "Connect Clarity"}
          </button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Behavioral health</h3>
          <button type="button" onClick={sync} disabled={loading === "sync"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "sync" ? "Syncing…" : "Sync from Clarity"}
          </button>
        </div>
        {summary && !summary.available && <p className="text-sm text-yellow-400">{summary.reason}</p>}
        {summary?.available && (
          <div className="flex flex-wrap gap-6 text-sm mb-3">
            <span><strong>{summary.totalSessions}</strong> sessions (3d)</span>
            <span><strong>{summary.pagesAnalyzed}</strong> pages</span>
            {typeof summary.conversionSignal === "number" && (
              <span>UX conversion signal: <strong>{summary.conversionSignal}/100</strong></span>
            )}
            <span className="text-red-400"><strong>{summary.issues.length}</strong> issues</span>
          </div>
        )}
        {summary?.available && summary.issues.length > 0 && (
          <ul className="space-y-2 text-sm max-h-80 overflow-y-auto">
            {summary.issues.slice(0, 30).map((i) => (
              <li key={`${i.kind}:${i.url}`} className="border border-border/50 rounded-lg p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{i.title}</span>
                  <span className={`text-xs uppercase ${SEV_STYLE[i.severity]}`}>{i.severity}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{i.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold mb-3">Per-page metrics</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-2">Page</th>
                  <th className="py-1 px-2">Sessions</th>
                  <th className="py-1 px-2">Scroll%</th>
                  <th className="py-1 px-2">Engage(s)</th>
                  <th className="py-1 px-2">Rage</th>
                  <th className="py-1 px-2">Dead</th>
                  <th className="py-1 px-2">Quickback</th>
                </tr>
              </thead>
              <tbody>
                {metrics.slice(0, 50).map((m) => (
                  <tr key={m.url} className="border-t border-border/40">
                    <td className="py-1 pr-2 truncate max-w-[260px]">{m.url}</td>
                    <td className="py-1 px-2">{m.sessions}</td>
                    <td className="py-1 px-2">{m.scroll_depth_pct != null ? Math.round(m.scroll_depth_pct) : "—"}</td>
                    <td className="py-1 px-2">{m.engagement_time_sec != null ? Math.round(m.engagement_time_sec) : "—"}</td>
                    <td className="py-1 px-2 text-red-400">{m.rage_clicks}</td>
                    <td className="py-1 px-2 text-yellow-400">{m.dead_clicks}</td>
                    <td className="py-1 px-2">{m.quickbacks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
