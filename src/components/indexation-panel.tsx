"use client";

import { useEffect, useState } from "react";

interface CoverageItem {
  url: string;
  action: string;
  reason: string;
  confidence: number;
  resolved: boolean;
}
interface CrawlerReport {
  total_lines: number;
  parsed_hits: number;
  ai_bots_seen: string[];
  search_bots_seen: string[];
  report: {
    byBot?: Record<string, { hits: number; uniquePaths: number; statuses: Record<string, number> }>;
    byPageType?: Record<string, number>;
    topPaths?: Array<{ path: string; hits: number }>;
  };
}

const ACTION_STYLE: Record<string, string> = {
  keep: "bg-green-500/15 text-green-400",
  improve: "bg-yellow-500/15 text-yellow-400",
  merge: "bg-orange-500/15 text-orange-400",
  canonicalize: "bg-blue-500/15 text-blue-400",
  noindex: "bg-purple-500/15 text-purple-400",
  redirect: "bg-cyan-500/15 text-cyan-400",
  delete: "bg-red-500/15 text-red-400",
};

export function IndexationPanel({ projectId }: { projectId: string }) {
  const [coverage, setCoverage] = useState<CoverageItem[]>([]);
  const [crawler, setCrawler] = useState<CrawlerReport | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [logText, setLogText] = useState("");
  const [loading, setLoading] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/indexation?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.coverage) setCoverage(d.coverage);
        if (d.crawlerReport) setCrawler(d.crawlerReport);
      });
  }, [projectId]);

  async function runCoverage() {
    setLoading("coverage");
    setMsg("");
    const res = await fetch("/api/indexation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "coverage" }),
    });
    const d = await res.json();
    if (d.available) {
      setCoverage(d.items || []);
      setSummary(d.summary || null);
    } else {
      setMsg(d.reason || "Unavailable");
    }
    setLoading("");
  }

  async function runLogs() {
    if (logText.trim().length < 10) return;
    setLoading("logs");
    setMsg("");
    const res = await fetch("/api/indexation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "crawler_logs", logText }),
    });
    const d = await res.json();
    if (d.available && d.report) {
      setCrawler({
        total_lines: d.report.totalLines,
        parsed_hits: d.report.parsedHits,
        ai_bots_seen: d.report.aiBotsSeen,
        search_bots_seen: d.report.searchBotsSeen,
        report: d.report,
      });
    } else {
      setMsg(d.error || d.reason || "Could not parse logs");
    }
    setLoading("");
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Index coverage management</h3>
          <button type="button" onClick={runCoverage} disabled={loading === "coverage"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "coverage" ? "Classifying…" : "Classify pages"}
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Combines Search Console performance with crawl status to recommend keep / improve / merge / canonicalize / noindex / redirect / delete.
        </p>
        {msg && <p className="text-sm text-yellow-400 mb-2">{msg}</p>}
        {summary && (
          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(summary).filter(([, n]) => n > 0).map(([a, n]) => (
              <span key={a} className={`rounded px-2 py-1 text-xs ${ACTION_STYLE[a] || "bg-muted"}`}>{a}: {n}</span>
            ))}
          </div>
        )}
        {coverage.length > 0 && (
          <ul className="text-sm space-y-1.5 max-h-80 overflow-y-auto">
            {coverage.map((c) => (
              <li key={c.url} className="flex items-center justify-between gap-2 border-b border-border/40 pb-1">
                <span className="truncate" title={c.reason}>
                  <span className="text-muted-foreground">{c.url}</span>
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${ACTION_STYLE[c.action] || "bg-muted"}`}>{c.action}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-2">AI &amp; search crawler logs</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Paste server access logs (common/combined format). We report which bots crawl you — Googlebot, Bingbot, GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended and more.
        </p>
        <textarea
          value={logText}
          onChange={(e) => setLogText(e.target.value)}
          placeholder='66.249.66.1 - - [25/Jun/2026:10:00:00 +0000] "GET /pricing HTTP/1.1" 200 1234 "-" "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)"'
          rows={5}
          className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs font-mono"
        />
        <button type="button" onClick={runLogs} disabled={loading === "logs"} className="mt-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50">
          {loading === "logs" ? "Analyzing…" : "Analyze logs"}
        </button>

        {crawler && (
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className="rounded px-2 py-1 text-xs bg-muted">{crawler.parsed_hits} bot hits / {crawler.total_lines} lines</span>
              {crawler.ai_bots_seen.map((b) => (
                <span key={b} className="rounded px-2 py-1 text-xs bg-green-500/15 text-green-400">AI: {b}</span>
              ))}
              {crawler.ai_bots_seen.length === 0 && (
                <span className="rounded px-2 py-1 text-xs bg-red-500/15 text-red-400">No AI bots seen — check robots.txt / CDN</span>
              )}
            </div>
            {crawler.report.byBot && (
              <div>
                <div className="font-medium mb-1">By bot</div>
                <ul className="space-y-1">
                  {Object.entries(crawler.report.byBot).sort((a, b) => b[1].hits - a[1].hits).map(([bot, s]) => (
                    <li key={bot} className="flex justify-between gap-2 text-muted-foreground">
                      <span>{bot}</span>
                      <span>{s.hits} hits · {s.uniquePaths} pages</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
