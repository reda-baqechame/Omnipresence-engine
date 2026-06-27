"use client";

import { useEffect, useState } from "react";

interface CrawlIssue {
  type: string;
  severity: string;
  title: string;
  detail: string;
  urls: string[];
}
interface DeepCrawlResult {
  available?: boolean;
  reason?: string;
  pagesCrawled?: number;
  maxDepth?: number;
  issues: CrawlIssue[];
}

const SEV_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high: "bg-orange-500/15 text-orange-400",
  medium: "bg-yellow-500/15 text-yellow-400",
  low: "bg-muted text-muted-foreground",
};

export function DeepCrawlPanel({ projectId }: { projectId: string }) {
  const [issues, setIssues] = useState<CrawlIssue[]>([]);
  const [meta, setMeta] = useState<{ pagesCrawled?: number; maxDepth?: number; reason?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/deep-crawl?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setIssues(d.issues || []));
  }, [projectId]);

  async function run() {
    setLoading(true);
    const res = await fetch("/api/deep-crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const d = (await res.json()) as DeepCrawlResult;
    setIssues(d.issues || []);
    setMeta({ pagesCrawled: d.pagesCrawled, maxDepth: d.maxDepth, reason: d.available ? undefined : d.reason });
    setLoading(false);
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold">Site-wide crawl</h3>
          <p className="text-xs text-muted-foreground">Keyless deep crawl: redirects, duplicate/missing titles &amp; H1s, thin content, broken links, orphans, depth.</p>
        </div>
        <button type="button" onClick={run} disabled={loading} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
          {loading ? "Crawling…" : "Run deep crawl"}
        </button>
      </div>
      {meta?.reason && <p className="text-sm text-yellow-400">{meta.reason}</p>}
      {meta && !meta.reason && (
        <p className="text-sm text-muted-foreground mb-2">Crawled {meta.pagesCrawled} pages · max depth {meta.maxDepth}</p>
      )}
      {issues.length > 0 ? (
        <ul className="space-y-2">
          {issues.map((i) => (
            <li key={i.type} className="border border-border/50 rounded-lg p-2">
              <button type="button" className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen(open === i.type ? null : i.type)}>
                <span className="font-medium text-sm">{i.title}</span>
                <span className={`text-xs uppercase px-1.5 py-0.5 rounded ${SEV_BADGE[i.severity]}`}>{i.severity}</span>
              </button>
              <p className="text-xs text-muted-foreground mt-1">{i.detail}</p>
              {open === i.type && i.urls.length > 0 && (
                <ul className="mt-2 text-xs text-muted-foreground space-y-0.5 max-h-48 overflow-y-auto">
                  {i.urls.map((u) => <li key={u} className="truncate">{u}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No crawl issues yet. Run a deep crawl to audit the whole site.</p>
      )}
    </div>
  );
}
