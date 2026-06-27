"use client";

import { useCallback, useEffect, useState } from "react";

interface Guarantee {
  id: string;
  name: string;
  met: boolean;
  evidence: string;
}
interface PlanRow {
  business_model: Record<string, unknown>;
  competitor_universe: Array<{ name: string; domain?: string }>;
  keyword_universe: Array<{ keyword: string; opportunity_score?: number; intent?: string }>;
  plan: Array<{ week: number; title: string; description: string; impact: string; category: string }>;
  generated_at: string;
}
interface Digest {
  cadence: string;
  window_days: number;
  gainers: Array<{ keyword: string; from: number | null; to: number | null; delta: number }>;
  losers: Array<{ keyword: string; from: number | null; to: number | null; delta: number }>;
  striking_distance: number;
  rank_alerts: number;
  technical_regressions: number;
  citation_gaps: number;
  tasks_created: number;
  generated_at: string;
}
interface Review {
  id: string;
  cadence: string;
  digest: Digest;
  tasks_created: number;
  created_at: string;
}

const CADENCES = ["daily", "weekly", "monthly", "quarterly"] as const;

export function OperatingPlanPanel({ projectId }: { projectId: string }) {
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [guarantees, setGuarantees] = useState<Guarantee[]>([]);
  const [loading, setLoading] = useState("");
  const [cadence, setCadence] = useState<(typeof CADENCES)[number]>("weekly");

  const load = useCallback(async () => {
    const res = await fetch(`/api/operating-plan?projectId=${projectId}`);
    const d = await res.json();
    setPlan(d.plan);
    setReviews(d.reviews || []);
    setGuarantees(d.guarantees || []);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/operating-plan?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setPlan(d.plan);
        setReviews(d.reviews || []);
        setGuarantees(d.guarantees || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  async function generatePlan() {
    setLoading("plan");
    await fetch("/api/operating-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "generate_plan" }),
    });
    await load();
    setLoading("");
  }

  async function runReview() {
    setLoading("review");
    await fetch("/api/operating-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, action: "run_review", cadence }),
    });
    await load();
    setLoading("");
  }

  const tier1Met = guarantees.length > 0 && guarantees.every((g) => g.met);

  return (
    <div className="space-y-6">
      {/* Operational guarantees */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Operational guarantees (auto-verified)</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full ${tier1Met ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"}`}>
            {tier1Met ? "All deliverables met" : "In progress"}
          </span>
        </div>
        <ul className="space-y-2">
          {guarantees.map((g) => (
            <li key={g.id} className="flex items-start gap-2 text-sm">
              <span className={g.met ? "text-green-400" : "text-muted-foreground"}>{g.met ? "✓" : "○"}</span>
              <div>
                <div className="font-medium">{g.name}</div>
                <div className="text-xs text-muted-foreground">{g.evidence}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground mt-3">
          We guarantee what we measure and cause — audit delivery, entity deployment, structural
          optimization, and measurable search movement. We never guarantee rankings or
          &quot;appearing everywhere in AI.&quot;
        </p>
      </div>

      {/* 90-day operating plan */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">90-day operating plan</h3>
          <button type="button" onClick={generatePlan} disabled={loading === "plan"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
            {loading === "plan" ? "Generating…" : plan ? "Regenerate" : "Generate plan"}
          </button>
        </div>
        {!plan && <p className="text-sm text-muted-foreground">Run a scan, then generate the plan to assemble your competitor list, keyword universe, and 90-day playbook.</p>}
        {plan && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-secondary/40 rounded-lg p-3">
                <div className="text-2xl font-bold">{plan.competitor_universe.length}</div>
                <div className="text-xs text-muted-foreground">Competitors</div>
              </div>
              <div className="bg-secondary/40 rounded-lg p-3">
                <div className="text-2xl font-bold">{plan.keyword_universe.length}</div>
                <div className="text-xs text-muted-foreground">Keywords</div>
              </div>
              <div className="bg-secondary/40 rounded-lg p-3">
                <div className="text-2xl font-bold">{plan.plan.length}</div>
                <div className="text-xs text-muted-foreground">Plan items</div>
              </div>
            </div>
            {plan.plan.length > 0 && (
              <ol className="space-y-1.5 text-sm">
                {plan.plan.slice(0, 12).map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground shrink-0 w-12">W{item.week}</span>
                    <span className="font-medium">{item.title}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">{item.impact}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">Generated {new Date(plan.generated_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Cadence reviews */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Operating cadence</h3>
          <div className="flex gap-2">
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as (typeof CADENCES)[number])}
              aria-label="Cadence"
              title="Cadence"
              className="bg-background border border-input rounded-lg px-2 py-1.5 text-sm"
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button type="button" onClick={runReview} disabled={loading === "review"} className="bg-primary text-primary-foreground px-3 py-1.5 rounded-lg text-sm disabled:opacity-50">
              {loading === "review" ? "Running…" : "Run review"}
            </button>
          </div>
        </div>
        {reviews.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet. Run a cadence review to surface gainers/losers, regressions, and create tasks.</p>}
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r.id} className="border border-border/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium capitalize">{r.cadence} review</span>
                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
                <div><div className="text-lg font-bold text-green-400">{r.digest.gainers?.length ?? 0}</div>Gainers</div>
                <div><div className="text-lg font-bold text-red-400">{r.digest.losers?.length ?? 0}</div>Losers</div>
                <div><div className="text-lg font-bold">{r.digest.technical_regressions}</div>Regressions</div>
                <div><div className="text-lg font-bold">{r.digest.citation_gaps}</div>Citation gaps</div>
                <div><div className="text-lg font-bold text-primary">{r.tasks_created}</div>Tasks</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
