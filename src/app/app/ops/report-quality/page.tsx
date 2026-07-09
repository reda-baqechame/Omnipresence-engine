"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface ViolationRow {
  id: string;
  project_id: string | null;
  report_id: string | null;
  severity: string;
  claim_id: string | null;
  section: string | null;
  reason: string | null;
  created_at: string;
}

interface ViolationsResponse {
  rows: ViolationRow[];
  count: number;
  generatedAt: string;
  flags?: {
    sanitizeEnabled: boolean;
    blockCriticalEnabled: boolean;
    note?: string;
  };
  error?: string;
}

export default function ReportQualityOpsPage() {
  const [data, setData] = useState<ViolationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [severity, setSeverity] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qs = severity ? `?severity=${encodeURIComponent(severity)}&limit=100` : "?limit=100";
      const res = await fetch(`/api/admin/report-quality-violations${qs}`);
      if (res.status === 401) {
        if (!cancelled) {
          setForbidden(true);
          setLoading(false);
        }
        return;
      }
      const json = await res.json();
      if (!cancelled) {
        setData(json);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [severity]);

  const topTypes = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data?.rows || []) {
      const k = r.claim_id || r.section || "unknown";
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  if (loading) return <div className="p-8">Loading report quality…</div>;
  if (forbidden) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">Report Quality Rollout</h1>
        <p className="text-sm text-muted-foreground">Platform admin required. Not customer-facing.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Report Quality Rollout</h1>
        <p className="text-sm text-muted-foreground">
          Internal violations feed. Flags default OFF — blocking is not active unless env enables it.
        </p>
        <Link href="/app/ops" className="text-sm text-primary hover:underline">
          ← Ops console
        </Link>
      </header>

      <section className="rounded-xl border border-border bg-card p-4 text-sm space-y-2">
        <h2 className="font-semibold">Rollout checklist</h2>
        <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
          <li>Observe violations (this page)</li>
          <li>Enable REPORT_QUALITY_SANITIZE=1 in staging</li>
          <li>Review false positives</li>
          <li>Enable REPORT_QUALITY_BLOCK_CRITICAL=1 in staging</li>
          <li>Promote to production only when clean</li>
        </ol>
        <p className="text-xs space-x-3">
          <span>
            Sanitize:{" "}
            <strong className={data?.flags?.sanitizeEnabled ? "text-yellow-400" : ""}>
              {data?.flags?.sanitizeEnabled ? "ON" : "OFF (default)"}
            </strong>
          </span>
          <span>
            Critical block:{" "}
            <strong className={data?.flags?.blockCriticalEnabled ? "text-red-400" : ""}>
              {data?.flags?.blockCriticalEnabled ? "ON" : "OFF (default)"}
            </strong>
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {data?.flags?.note || "Warnings never block unless critical block is enabled."}
        </p>
      </section>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="bg-background border border-border rounded-lg text-xs px-2 py-1.5"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="">All severities</option>
          <option value="error">error</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
        </select>
        <span className="text-xs text-muted-foreground">{data?.count ?? 0} rows</span>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold mb-2 text-sm">Top violation types</h2>
        <ul className="text-xs space-y-1">
          {topTypes.map(([k, n]) => (
            <li key={k} className="flex justify-between">
              <span>{k}</span>
              <span>{n}</span>
            </li>
          ))}
          {topTypes.length === 0 && <li className="text-muted-foreground">No violations recorded.</li>}
        </ul>
      </section>

      <ul className="space-y-2">
        {(data?.rows || []).map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-card p-3 text-xs space-y-1">
            <div className="flex flex-wrap gap-2">
              <span className="uppercase border border-border rounded px-1.5">{r.severity}</span>
              <span className="text-muted-foreground">{r.claim_id || r.section || "—"}</span>
              <span className="text-muted-foreground ml-auto">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
            <p>{r.reason}</p>
            <p className="text-muted-foreground">
              project {r.project_id || "—"} · report {r.report_id || "—"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
