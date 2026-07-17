"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldAlert, ShieldCheck, RefreshCw } from "lucide-react";

interface ReviewedClaim {
  claim: string;
  quote: string;
  engine: string;
  surface: string | null;
  prompt: string;
  verdict: "contradicted" | "unsupported" | "supported";
  explanation: string;
  receipt_id: string;
}

interface ClaimReview {
  id: string | null;
  status: string;
  claims: ReviewedClaim[];
  answers_reviewed: number;
  flagged_count: number;
  reason?: string;
  created_at: string;
}

const VERDICT_STYLE: Record<ReviewedClaim["verdict"], { label: string; cls: string }> = {
  contradicted: { label: "Contradicted", cls: "bg-red-500/10 text-red-400 border-red-500/30" },
  unsupported: { label: "Unsupported", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  supported: { label: "Supported", cls: "bg-green-500/10 text-green-400 border-green-500/30" },
};

export function ClaimReviewPanel({ projectId }: { projectId: string }) {
  const [reviews, setReviews] = useState<ClaimReview[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/claims?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => setReviews(d.reviews || []))
      .catch(() => setReviews([]));
  }, [projectId]);

  async function runReview() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Review failed");
      setReviews((prev) => [d.review, ...(prev || [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    }
    setRunning(false);
  }

  if (reviews === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reviews…
      </div>
    );
  }

  const latest = reviews[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {latest
            ? `Last review: ${new Date(latest.created_at).toLocaleString()} — ${latest.answers_reviewed} answers checked, ${latest.flagged_count} flagged.`
            : "No reviews yet. Each review checks the AI answers captured as receipts against your own site's facts."}
        </p>
        <button
          onClick={runReview}
          disabled={running}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 shrink-0"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {running ? "Reviewing…" : "Run claim review"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {latest?.status === "no_answers" && (
        <div className="bg-card border border-border rounded-xl p-5 text-sm text-muted-foreground">
          {latest.reason}
        </div>
      )}

      {latest && latest.claims.length > 0 && (
        <div className="space-y-3">
          {latest.claims
            .slice()
            .sort((a, b) => (a.verdict === "supported" ? 1 : 0) - (b.verdict === "supported" ? 1 : 0))
            .map((c, i) => (
              <div key={`${c.receipt_id}-${i}`} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {c.verdict === "supported" ? (
                      <ShieldCheck className="h-4 w-4 text-green-400 shrink-0" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                    )}
                    <span className="font-medium text-sm">{c.claim}</span>
                  </div>
                  <span className={`text-xs border rounded-full px-2 py-0.5 shrink-0 ${VERDICT_STYLE[c.verdict].cls}`}>
                    {VERDICT_STYLE[c.verdict].label}
                  </span>
                </div>
                <blockquote className="text-xs text-muted-foreground border-l-2 border-border pl-3 mt-2 italic">
                  “{c.quote}”
                </blockquote>
                <p className="text-xs text-muted-foreground mt-2">{c.explanation}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{c.engine}{c.surface ? ` · ${c.surface}` : ""}</span>
                  <Link href={`/verify/${c.receipt_id}`} className="text-primary hover:underline" target="_blank">
                    View receipt
                  </Link>
                </div>
              </div>
            ))}
        </div>
      )}

      {latest && latest.status === "completed" && latest.claims.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-5 text-sm text-muted-foreground">
          No specific factual claims about the brand were found in the reviewed answers — nothing to
          flag this run.
        </div>
      )}
    </div>
  );
}
