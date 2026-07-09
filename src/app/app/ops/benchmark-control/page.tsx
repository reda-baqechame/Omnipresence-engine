"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface EnvCheck {
  key: string;
  purpose: string;
  present: boolean;
  required: boolean;
}

interface Readiness {
  generatedAt: string;
  env: EnvCheck[];
  migrationsOk: boolean;
  evidenceStarted: boolean;
  latestRunAt: string | null;
  rowCountLookback: number;
  warnings: string[];
  errors: string[];
  manualTriggerNotes: string[];
  error?: string;
}

export default function BenchmarkControlPage() {
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/benchmark-readiness");
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
  }, []);

  if (loading) return <div className="p-8">Loading benchmark control…</div>;
  if (forbidden) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">Benchmark Control</h1>
        <p className="text-sm text-muted-foreground">Platform admin required.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Benchmark Control</h1>
        <p className="text-sm text-muted-foreground">
          Staging proof readiness. This UI never invents rows and does not call paid providers.
        </p>
        <Link href="/app/ops/provider-proof" className="text-sm text-primary hover:underline">
          Provider proof →
        </Link>
      </header>

      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <h2 className="font-semibold">Evidence status</h2>
        <p className="text-sm">
          {data?.evidenceStarted
            ? `Started — ${data.rowCountLookback} rows in lookback; latest ${data.latestRunAt}`
            : "Infrastructure ready, no benchmark evidence yet"}
        </p>
        <p className="text-xs text-muted-foreground">
          Migrations: {data?.migrationsOk ? "ok" : "missing tables"}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold mb-2">Environment</h2>
        <ul className="space-y-1 text-sm">
          {(data?.env || []).map((e) => (
            <li key={e.key} className="flex justify-between gap-2">
              <span>
                {e.key}{" "}
                <span className="text-muted-foreground text-xs">— {e.purpose}</span>
              </span>
              <span className={e.present ? "text-green-400" : e.required ? "text-yellow-400" : "text-muted-foreground"}>
                {e.present ? "ok" : e.required ? "missing" : "optional"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(data?.warnings?.length || 0) > 0 && (
        <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-sm">
          <h2 className="font-semibold mb-1">Warnings</h2>
          <ul className="list-disc pl-5 space-y-1">
            {data!.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-4 text-sm space-y-2">
        <h2 className="font-semibold">Manual trigger (staging)</h2>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          {(data?.manualTriggerNotes || []).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p className="text-xs text-yellow-500">
          Warning: no fake rows. Paid calls only via explicit admin secret + staging config.
        </p>
      </section>
    </div>
  );
}
