"use client";

import { useEffect, useState } from "react";

interface Mention {
  platform: string;
  url: string;
  title?: string;
  sentiment: string;
  is_unlinked: boolean;
}
interface AiIssue {
  claim: string;
  likely_source: string;
  correction: string;
  fix_asset: string;
}
interface AiSentiment {
  overall_sentiment: string;
  summary: string;
  issues: AiIssue[];
}
interface SerpResult {
  position: number;
  url: string;
  title: string;
  owned: boolean;
}
interface BrandSerp {
  available: boolean;
  reason?: string;
  ownedCount: number;
  thirdPartyCount: number;
  results: SerpResult[];
  missingProfiles: string[];
}

const SENT_STYLE: Record<string, string> = {
  positive: "text-green-400",
  neutral: "text-muted-foreground",
  negative: "text-red-400",
  unknown: "text-muted-foreground",
};

export function ReputationPanel({ projectId }: { projectId: string }) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState("");
  const [ai, setAi] = useState<{ available: boolean; reason?: string; result?: AiSentiment } | null>(null);
  const [serp, setSerp] = useState<BrandSerp | null>(null);

  useEffect(() => {
    fetch(`/api/reputation?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => setMentions(d.mentions || []));
  }, [projectId]);

  async function post(action: string) {
    const res = await fetch("/api/reputation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action }),
    });
    return res.json();
  }

  async function runMonitor() {
    setLoading("monitor");
    const d = await post("monitor");
    setMentions(d.mentions || []);
    setLoading("");
  }
  async function runAi() {
    setLoading("ai");
    setAi(await post("ai_sentiment"));
    setLoading("");
  }
  async function runSerp() {
    setLoading("serp");
    setSerp(await post("brand_serp"));
    setLoading("");
  }

  const negative = mentions.filter((m) => m.sentiment === "negative").length;
  const unlinked = mentions.filter((m) => m.is_unlinked).length;

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Mention monitoring</h3>
          <button type="button" onClick={runMonitor} disabled={loading === "monitor"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "monitor" ? "Scanning…" : "Scan mentions"}
          </button>
        </div>
        {mentions.length > 0 ? (
          <>
            <div className="flex gap-6 text-sm mb-3">
              <span><strong>{mentions.length}</strong> mentions</span>
              <span className="text-red-400"><strong>{negative}</strong> negative</span>
              <span className="text-yellow-400"><strong>{unlinked}</strong> unlinked</span>
            </div>
            <ul className="space-y-1.5 text-sm max-h-72 overflow-y-auto">
              {mentions.slice(0, 40).map((m) => (
                <li key={m.url} className="flex items-center justify-between gap-2">
                  <a href={m.url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">{m.title || m.url}</a>
                  <span className="flex items-center gap-2 shrink-0 text-xs">
                    <span className="text-muted-foreground">{m.platform}</span>
                    <span className={SENT_STYLE[m.sentiment]}>{m.sentiment}</span>
                    {m.is_unlinked && <span className="text-yellow-400">unlinked</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No mentions yet. Run a scan to find where your brand is discussed.</p>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">AI brand-sentiment correction</h3>
          <button type="button" onClick={runAi} disabled={loading === "ai"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "ai" ? "Analyzing…" : "Analyze AI sentiment"}
          </button>
        </div>
        {ai && (
          ai.available && ai.result ? (
            <div className="text-sm space-y-3">
              <div>
                Overall: <span className="font-medium capitalize">{ai.result.overall_sentiment}</span>
                <p className="text-muted-foreground mt-1">{ai.result.summary}</p>
              </div>
              {ai.result.issues.map((iss) => (
                <div key={iss.claim} className="border border-border/50 rounded-lg p-2">
                  <div className="font-medium text-red-400">{iss.claim}</div>
                  <p className="text-xs text-muted-foreground">Source: {iss.likely_source}</p>
                  <p className="mt-1">{iss.correction}</p>
                  <p className="text-xs text-primary mt-1">Publish: {iss.fix_asset}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-yellow-400">{ai?.reason}</p>
          )
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Brand SERP control</h3>
          <button type="button" onClick={runSerp} disabled={loading === "serp"} className="border border-border px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "serp" ? "Auditing…" : "Audit brand SERP"}
          </button>
        </div>
        {serp && (
          serp.available ? (
            <div className="text-sm">
              <div className="flex gap-6 mb-2">
                <span className="text-green-400"><strong>{serp.ownedCount}</strong> owned</span>
                <span className="text-muted-foreground"><strong>{serp.thirdPartyCount}</strong> third-party</span>
              </div>
              {serp.missingProfiles.length > 0 && (
                <p className="text-yellow-400 mb-2">Missing owned profiles: {serp.missingProfiles.join(", ")}</p>
              )}
              <ol className="space-y-1">
                {serp.results.map((r) => (
                  <li key={r.position} className="flex gap-2">
                    <span className="text-muted-foreground w-5">{r.position}.</span>
                    <a href={r.url} target="_blank" rel="noreferrer" className={r.owned ? "text-green-400 hover:underline truncate" : "text-primary hover:underline truncate"}>{r.title}</a>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-yellow-400">{serp.reason}</p>
          )
        )}
      </div>
    </div>
  );
}
