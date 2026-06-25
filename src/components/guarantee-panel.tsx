"use client";

import { useState } from "react";
import type { ResultsLedgerEntry } from "@/types/database";
import type { TwoTierGuarantee } from "@/lib/engines/guarantee";

export interface GuaranteeMetrics {
  omnipresence_score: number;
  citation_rate: number;
  visibility_mention_rate: number;
}

interface GuaranteePanelProps {
  projectId: string;
  contract: Record<string, unknown> | null;
  claims: Array<Record<string, unknown>>;
  ledger: ResultsLedgerEntry[];
  latestMetrics: GuaranteeMetrics;
  twoTier?: TwoTierGuarantee;
}

export function GuaranteePanel({
  projectId,
  contract,
  claims,
  ledger,
  latestMetrics,
  twoTier,
}: GuaranteePanelProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runAction(action: "lock_baseline" | "verify" | "claim") {
    setLoading(true);
    setMessage(null);
    const body: Record<string, unknown> = { projectId, action };
    if (action === "lock_baseline") {
      body.snapshot = {
        omnipresence_score: latestMetrics.omnipresence_score,
        citation_rate: latestMetrics.citation_rate,
        visibility_mention_rate: latestMetrics.visibility_mention_rate,
      };
    }
    if (action === "verify") {
      body.currentMetrics = { ...latestMetrics };
    }
    const res = await fetch("/api/guarantee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setMessage(res.ok ? "Action completed" : data.error || "Action failed");
    setLoading(false);
    if (res.ok) window.location.reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-2">Results Guarantee</h2>
        <p className="text-sm text-muted-foreground">
          Two-tier model: deterministic deliverables are shipped outright, and the measured citation/visibility lift is backed by a service credit if the threshold is not met after the window.
        </p>
      </div>

      {twoTier && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Tier 1 — Guaranteed deliverables</h3>
              <span className={twoTier.tier1Met ? "text-green-400 text-sm" : "text-yellow-400 text-sm"}>
                {twoTier.tier1Met ? "All shipped" : "In progress"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Controllable, deterministic levers we deliver outright.
            </p>
            <ul className="text-sm space-y-2">
              {twoTier.deterministicDeliverables.map((d) => (
                <li key={d.id} className="flex justify-between border-b border-border pb-2">
                  <span>{d.name}</span>
                  <span className={d.met ? "text-green-400" : "text-muted-foreground"}>
                    {d.met ? "Met" : `${d.score}/100`}
                  </span>
                </li>
              ))}
              {twoTier.deterministicDeliverables.length === 0 && (
                <li className="text-muted-foreground">Run a scan to populate AEO readiness.</li>
              )}
            </ul>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="font-semibold mb-3">Tier 2 — Measured lift (refundable)</h3>
            <p className="text-xs text-muted-foreground mb-4">
              We guarantee a measured aggregate lift over the window, or a service credit. We never promise a specific ChatGPT ranking.
            </p>
            <div className="text-sm space-y-2">
              <div className="flex justify-between border-b border-border pb-2">
                <span>Guaranteed KPI</span>
                <span className="text-primary">{twoTier.tier2Kpi}</span>
              </div>
              <div className="flex justify-between border-b border-border pb-2">
                <span>Required lift</span>
                <span className="text-primary">
                  +{twoTier.tier2Kpi === "citation_rate" ? `${Math.round(twoTier.tier2Threshold * 100)}%` : twoTier.tier2Threshold}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Remedy if unmet</span>
                <span className="text-muted-foreground">Service credit</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">Current score</div>
          <div className="text-2xl font-bold text-primary">{latestMetrics.omnipresence_score}</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">Citation rate</div>
          <div className="text-2xl font-bold">{Math.round(latestMetrics.citation_rate * 100)}%</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">Mention rate</div>
          <div className="text-2xl font-bold">{Math.round(latestMetrics.visibility_mention_rate * 100)}%</div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">Contract status</div>
          <div className="text-lg font-semibold">{(contract?.status as string) || "not started"}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">KPI / threshold</div>
          <div className="text-lg font-semibold">
            {(contract?.kpi_metric as string) || "omnipresence_score"} +{(contract?.threshold_value as number) ?? 15}
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="text-sm text-muted-foreground">Claims</div>
          <div className="text-lg font-semibold">{claims.length}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => runAction("lock_baseline")}
          disabled={loading || latestMetrics.omnipresence_score === 0}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Lock baseline
        </button>
        <button
          onClick={() => runAction("verify")}
          disabled={loading || !contract}
          className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Run verification
        </button>
        <button
          onClick={() => runAction("claim")}
          disabled={loading || contract?.status !== "failed"}
          className="border border-border px-4 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          Submit claim
        </button>
      </div>
      {latestMetrics.omnipresence_score === 0 && (
        <p className="text-sm text-yellow-400">Run a full project scan first to populate live scores.</p>
      )}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-3">Qualified traffic rules</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Traffic counts toward guarantee KPI only when all qualification rules pass.
        </p>
        <ul className="text-sm space-y-2">
          <li className="flex justify-between border-b border-border pb-2">
            <span>Minimum session duration</span>
            <span className="text-muted-foreground">30 seconds</span>
          </li>
          <li className="flex justify-between border-b border-border pb-2">
            <span>Exclude bot user-agents</span>
            <span className="text-green-400">Enabled</span>
          </li>
          <li className="flex justify-between border-b border-border pb-2">
            <span>Organic or AI-referral source required</span>
            <span className="text-green-400">Enabled</span>
          </li>
          <li className="flex justify-between border-b border-border pb-2">
            <span>Geographic match (project locale)</span>
            <span className="text-muted-foreground">When GA4 connected</span>
          </li>
          <li className="flex justify-between">
            <span>KPI threshold for credit claim</span>
            <span className="text-primary">
              +{(contract?.threshold_value as number) ?? 15} {(contract?.kpi_metric as string) || "omnipresence_score"}
            </span>
          </li>
        </ul>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-semibold mb-3">Results ledger (proof)</h3>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {ledger.map((entry) => (
            <div key={entry.id} className="flex justify-between text-sm border-b border-border pb-2">
              <span>{entry.description}</span>
              <span className="text-muted-foreground">{entry.status}</span>
            </div>
          ))}
          {ledger.length === 0 && (
            <p className="text-sm text-muted-foreground">No ledger entries yet. Actions from publishing, schema, and scans appear here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
