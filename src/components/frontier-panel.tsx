"use client";

import { useState } from "react";

interface FanoutSubquery {
  subquery: string;
  position: number | null;
  url?: string;
  retrievable: boolean;
}
interface FanoutResult {
  available: boolean;
  prompt: string;
  subqueries: FanoutSubquery[];
  retrievableCount: number;
  coverage: number;
  reason?: string;
}
interface CitationGap {
  source_domain: string;
  competitor_citations: number;
  competitors: string[];
  prompts: string[];
  difficulty: number;
  tactic: string;
  outreach_angle: string;
}
interface EarnedMediaPlan {
  newsworthy: boolean;
  scope_warning: string;
  headline: string;
  angle: string;
  press_release: string;
  target_outlets: { name: string; type: string; why: string }[];
  supporting_assets: string[];
  pitch_email: string;
}

export function FrontierPanel({
  projectId,
  prompts,
}: {
  projectId: string;
  prompts: string[];
}) {
  const [selectedPrompt, setSelectedPrompt] = useState(prompts[0] || "");
  const [customPrompt, setCustomPrompt] = useState("");
  const [loading, setLoading] = useState("");
  const [fanout, setFanout] = useState<FanoutResult | null>(null);
  const [gaps, setGaps] = useState<CitationGap[] | null>(null);
  const [gapsMsg, setGapsMsg] = useState("");
  const [plan, setPlan] = useState<EarnedMediaPlan | null>(null);
  const [planMsg, setPlanMsg] = useState("");

  const activePrompt = customPrompt.trim() || selectedPrompt;

  async function post(action: string, prompt?: string) {
    const res = await fetch("/api/frontier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action, prompt }),
    });
    return res.json();
  }

  async function runFanout() {
    if (!activePrompt) return;
    setLoading("fanout");
    setFanout(await post("fanout", activePrompt));
    setLoading("");
  }

  async function runGaps() {
    setLoading("gaps");
    const data = await post("citation_gaps");
    setGaps(data.gaps || []);
    setGapsMsg(data.available ? "" : data.reason || "Unavailable");
    setLoading("");
  }

  async function runEarnedMedia() {
    if (!activePrompt) return;
    setLoading("earned");
    const data = await post("earned_media", activePrompt);
    setPlan(data.plan || null);
    setPlanMsg(data.available ? "" : data.reason || "Unavailable");
    setLoading("");
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="font-semibold mb-1">Frontier AEO Levers</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Fan-out interception, AI citation-gap mining, and scoped earned-media plans. All
          ranks are measured; AI generation powers sub-query and pitch drafting.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {prompts.length > 0 && (
            <select
              value={selectedPrompt}
              onChange={(e) => setSelectedPrompt(e.target.value)}
              aria-label="Tracked prompt"
              className="flex-1 min-w-[220px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
            >
              {prompts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <input
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="…or type a custom prompt"
            className="flex-1 min-w-[200px] bg-background border border-input rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            onClick={runFanout}
            disabled={loading === "fanout" || !activePrompt}
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading === "fanout" ? "Intercepting…" : "Run fan-out interception"}
          </button>
          <button
            type="button"
            onClick={runGaps}
            disabled={loading === "gaps"}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading === "gaps" ? "Mining…" : "Find AI citation gaps"}
          </button>
          <button
            type="button"
            onClick={runEarnedMedia}
            disabled={loading === "earned" || !activePrompt}
            className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading === "earned" ? "Drafting…" : "Earned-media plan"}
          </button>
        </div>
      </div>

      {fanout && (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold">Fan-out interception</h4>
            {fanout.available && (
              <span className="text-sm text-muted-foreground">
                Retrievable for {fanout.retrievableCount}/{fanout.subqueries.length} sub-queries (
                {Math.round(fanout.coverage * 100)}%)
              </span>
            )}
          </div>
          {!fanout.available ? (
            <p className="text-sm text-yellow-400">{fanout.reason}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Likely sub-query</th>
                  <th className="text-right p-2">Your rank</th>
                  <th className="text-left p-2">Retrievable</th>
                </tr>
              </thead>
              <tbody>
                {fanout.subqueries.map((s) => (
                  <tr key={s.subquery} className="border-t border-border/50">
                    <td className="p-2">{s.subquery}</td>
                    <td className="p-2 text-right">{s.position ?? "—"}</td>
                    <td className="p-2">
                      {s.retrievable ? (
                        <span className="text-green-400">✓ top 10</span>
                      ) : (
                        <span className="text-red-400">✗ not retrievable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {gaps && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-semibold mb-3">AI citation gaps (cite competitors, not you)</h4>
          {gapsMsg ? (
            <p className="text-sm text-yellow-400">{gapsMsg}</p>
          ) : gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No citation gaps found — nice coverage.</p>
          ) : (
            <ul className="space-y-3">
              {gaps.slice(0, 20).map((g) => (
                <li key={g.source_domain} className="border border-border/50 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{g.source_domain}</span>
                    <span className="text-xs text-muted-foreground">
                      cites {g.competitor_citations} competitor mention(s) · {g.tactic.replace(/_/g, " ")} · difficulty {g.difficulty}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{g.outreach_angle}</p>
                  {g.competitors.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">Competitors cited: {g.competitors.join(", ")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(plan || planMsg) && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h4 className="font-semibold mb-2">Earned-media plan</h4>
          {planMsg ? (
            <p className="text-sm text-yellow-400">{planMsg}</p>
          ) : plan ? (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-yellow-400">{plan.scope_warning}</p>
              {!plan.newsworthy && (
                <p className="text-orange-400">No strong newsworthy angle detected — treat as low-priority.</p>
              )}
              <div>
                <span className="font-medium">{plan.headline}</span>
                <p className="text-muted-foreground mt-1">{plan.angle}</p>
              </div>
              <div>
                <div className="font-medium mb-1">Press release</div>
                <p className="text-muted-foreground whitespace-pre-wrap">{plan.press_release}</p>
              </div>
              <div>
                <div className="font-medium mb-1">Target outlets</div>
                <ul className="list-disc list-inside text-muted-foreground">
                  {plan.target_outlets.map((o) => (
                    <li key={o.name}>
                      <span className="text-foreground">{o.name}</span> ({o.type}) — {o.why}
                    </li>
                  ))}
                </ul>
              </div>
              {plan.supporting_assets.length > 0 && (
                <div>
                  <div className="font-medium mb-1">Supporting assets needed</div>
                  <ul className="list-disc list-inside text-muted-foreground">
                    {plan.supporting_assets.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="font-medium mb-1">Pitch email</div>
                <p className="text-muted-foreground whitespace-pre-wrap">{plan.pitch_email}</p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
