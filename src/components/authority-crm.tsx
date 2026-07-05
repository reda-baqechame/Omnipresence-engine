"use client";

import { useState } from "react";
import type { AuthorityOpportunity } from "@/types/database";
import { ProvenanceBadge } from "@/components/provenance-badge";

interface AuthorityCRMProps {
  projectId: string;
  opportunities: AuthorityOpportunity[];
}

const STATUS_FLOW = [
  "identified",
  "researched",
  "pitched",
  "followed_up",
  "accepted",
  "published",
  "rejected",
] as const;

export function AuthorityCRM({ projectId, opportunities: initial }: AuthorityCRMProps) {
  const [opportunities, setOpportunities] = useState(initial);
  const [generating, setGenerating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function generateOutreach(id: string) {
    setGenerating(id);
    const res = await fetch("/api/authority", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: id }),
    });
    const { opportunity } = await res.json();
    if (opportunity) {
      setOpportunities((prev) => prev.map((o) => (o.id === id ? opportunity : o)));
      setExpanded(id);
    }
    setGenerating(null);
  }

  async function updateStatus(id: string, status: string) {
    const res = await fetch("/api/authority", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunityId: id, status }),
    });
    const { opportunity } = await res.json();
    if (opportunity) {
      setOpportunities((prev) => prev.map((o) => (o.id === id ? opportunity : o)));
    }
  }

  const byStatus = STATUS_FLOW.reduce(
    (acc, status) => {
      acc[status] = opportunities.filter((o) => o.status === status);
      return acc;
    },
    {} as Record<string, AuthorityOpportunity[]>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-7 gap-2">
        {STATUS_FLOW.map((status) => (
          <div key={status} className="text-center">
            <div className="text-lg font-bold text-primary">{byStatus[status]?.length || 0}</div>
            <div className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {opportunities.map((opp) => (
          <div key={opp.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">{opp.target_site}</h3>
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{opp.type}</span>
                  {opp.competitor_present && (
                    <span className="text-xs bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded">Competitor gap</span>
                  )}
                  <ProvenanceBadge
                    quality={opp.data_source ?? (opp.measured ? "measured" : "unavailable")}
                    confidence={opp.confidence}
                    provider={opp.provider}
                    lastCheckedAt={opp.last_checked_at}
                    evidenceUrl={opp.evidence_url || opp.target_url}
                  />
                </div>
                <p className="text-sm text-muted-foreground">{opp.pitch_angle}</p>
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                  <span>Impact: {opp.estimated_impact}/100</span>
                  <span>Difficulty: {opp.difficulty_score}/100</span>
                  {opp.domain_authority && <span>DA: {opp.domain_authority}</span>}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <select
                  value={opp.status}
                  onChange={(e) => updateStatus(opp.id, e.target.value)}
                  title={`Update status for ${opp.target_site}`}
                  className="bg-background border border-input rounded-lg px-2 py-1 text-xs"
                >
                  {STATUS_FLOW.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
                {!opp.outreach_email && (
                  <button
                    onClick={() => generateOutreach(opp.id)}
                    disabled={generating === opp.id}
                    className="bg-primary text-primary-foreground px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {generating === opp.id ? "Generating..." : "Generate Pitch"}
                  </button>
                )}
              </div>
            </div>

            {expanded === opp.id && opp.outreach_email && (
              <div className="mt-4 pt-4 border-t border-border space-y-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Outreach Email</div>
                  <pre className="text-xs bg-secondary rounded-lg p-3 whitespace-pre-wrap font-sans">{opp.outreach_email}</pre>
                </div>
                {opp.follow_up_email && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">Follow-up</div>
                    <pre className="text-xs bg-secondary rounded-lg p-3 whitespace-pre-wrap font-sans">{opp.follow_up_email}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {opportunities.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-8">
            No authority opportunities yet. Run a scan to discover competitor gaps.
          </p>
        )}
      </div>
    </div>
  );
}
