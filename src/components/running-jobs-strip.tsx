"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { JobProgressBar } from "@/components/job-progress-bar";
import { formatJobCost, formatTokenCount } from "@/lib/utils";
import type { RunningJob } from "@/app/api/jobs/running/route";

const POLL_MS = 5000;

function jobKey(job: RunningJob): string {
  return `${job.kind}:${job.id}`;
}

function jobLabel(job: RunningJob): string {
  if (job.kind === "report") {
    return `${job.reportType === "deep" ? "Deep report" : "Report"}: ${job.title}`;
  }
  return "AI visibility scan";
}

function jobSubLabel(job: RunningJob): string {
  const project = job.projectName || "Project";
  const step = job.currentStep ? ` — ${job.currentStep}` : "";
  const state = job.status === "cancelling" ? " (stopping…)" : "";
  return `${project}${step}${state}`;
}

/**
 * Honest running-spend readout: shows $0.00 / 0 tokens until a guarded
 * provider call has actually landed inside this job (job-context rollup,
 * migration 0078) — never a fabricated estimate before real spend exists.
 */
function jobCostLabel(job: RunningJob): string | null {
  if (job.actualCost <= 0 && job.tokensUsed <= 0) return null;
  const cost = formatJobCost(job.actualCost);
  return job.tokensUsed > 0 ? `${cost} · ${formatTokenCount(job.tokensUsed)}` : cost;
}

/**
 * Global "nothing expensive runs invisibly" strip: polls every in-flight
 * report/scan the signed-in user can see and renders a Stop button wired to
 * the ticket-4 cancel routes. Reuses scan-poller.tsx's setInterval pattern.
 */
export function RunningJobsStrip() {
  const router = useRouter();
  const [jobs, setJobs] = useState<RunningJob[]>([]);
  const [stoppingIds, setStoppingIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/running");
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: RunningJob[] };
      setJobs(data.jobs || []);
    } catch {
      // Best-effort — a failed poll just tries again next interval.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(poll, POLL_MS);
    // First poll fires immediately via a macrotask (not synchronously in the
    // effect body) so the strip appears promptly without tripping the
    // set-state-in-effect lint rule.
    const kickoff = setTimeout(poll, 0);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
    };
  }, [poll]);

  async function stopJob(job: RunningJob) {
    const key = jobKey(job);
    setStoppingIds((prev) => new Set(prev).add(key));
    try {
      const url =
        job.kind === "report"
          ? `/api/projects/${job.projectId}/report/${job.id}/cancel`
          : `/api/projects/${job.projectId}/scan/cancel`;
      await fetch(url, { method: "POST" });
      await poll();
      router.refresh();
    } finally {
      setStoppingIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (!loaded || jobs.length === 0) return null;

  return (
    <div className="sticky top-0 z-40 space-y-2 border-b border-border bg-background/95 p-3 backdrop-blur">
      {jobs.map((job) => (
        <JobProgressBar
          key={jobKey(job)}
          label={jobLabel(job)}
          subLabel={jobSubLabel(job)}
          progressPercent={job.progressPercent}
          costLabel={jobCostLabel(job)}
          stopping={stoppingIds.has(jobKey(job)) || job.status === "cancelling"}
          onStop={() => stopJob(job)}
        />
      ))}
    </div>
  );
}
