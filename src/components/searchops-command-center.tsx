"use client";

import Link from "next/link";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import type {
  CommandMetricCard,
  DataSourceHealthRow,
  ExecutionStatusSummary,
  ReportQualityStatusSummary,
  SearchOpsCommandCenter,
} from "@/lib/engines/searchops-command-center";
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import type { DataQuality } from "@/types/database";

function statusToDq(status: CommandMetricCard["status"]): DataQuality {
  return status;
}

function MetricCard({ projectId, m }: { projectId: string; m: CommandMetricCard }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 min-h-[140px]">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{m.label}</h3>
        <ProvenanceBadge quality={statusToDq(m.status)} provider={m.source ?? undefined} />
      </div>
      <div className="text-2xl font-semibold tracking-tight">{m.display}</div>
      {m.status === "unavailable" && m.whyUnavailable && (
        <p className="text-xs text-muted-foreground">{m.whyUnavailable}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {m.source && <span>Source: {m.source}</span>}
        {m.freshness && <span>· {new Date(m.freshness).toLocaleDateString()}</span>}
        {m.confidence != null && <span>· Conf. {Math.round(m.confidence * 100)}%</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {m.evidenceHref && (
          <Link href={m.evidenceHref} className="text-xs text-primary hover:underline">
            Open surface →
          </Link>
        )}
        <EvidenceDrawer
          projectId={projectId}
          capability={m.id}
          target={m.id}
          label="View evidence"
          className="text-xs"
        />
      </div>
    </div>
  );
}

function SourceRow({ s }: { s: DataSourceHealthRow }) {
  const tone =
    s.status === "connected" || s.status === "active"
      ? "text-green-400"
      : s.status === "fallback_only"
        ? "text-yellow-400"
        : s.status === "disconnected"
          ? "text-orange-400"
          : "text-muted-foreground";
  return (
    <li className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <div>
        <div className="text-sm font-medium">
          {s.label}{" "}
          <span className="text-[10px] uppercase text-muted-foreground">· {s.kind}</span>
        </div>
        <p className="text-xs text-muted-foreground">{s.note}</p>
      </div>
      <div className="text-right text-xs shrink-0">
        <div className={tone}>{s.status.replace(/_/g, " ")}</div>
        {s.lastCollected && (
          <div className="text-muted-foreground">{new Date(s.lastCollected).toLocaleDateString()}</div>
        )}
      </div>
    </li>
  );
}

function OpportunityRow({
  projectId,
  op,
}: {
  projectId: string;
  op: SearchOpsOpportunity;
}) {
  return (
    <li className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border">
          {op.category}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border">
          {op.priority}
        </span>
        <ProvenanceBadge quality={op.impactType} />
        <span className="text-sm font-medium">{op.title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{op.diagnosis}</p>
      <p className="text-xs">
        <span className="text-muted-foreground">Next: </span>
        {op.recommendedAction}
      </p>
      <p className="text-xs">
        <span className="text-muted-foreground">Verify: </span>
        {op.verificationPlan}
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        <EvidenceDrawer
          projectId={projectId}
          capability={op.category}
          target={op.id}
          label="Why this exists"
          className="text-xs"
        />
        <Link href={`/app/projects/${projectId}/opportunities`} className="text-primary hover:underline">
          All opportunities →
        </Link>
        <Link href={`/app/projects/${projectId}/tasks`} className="text-primary hover:underline">
          Create task →
        </Link>
      </div>
    </li>
  );
}

function ExecutionStrip({ e }: { e: ExecutionStatusSummary }) {
  const cells = [
    ["Todo", e.todo],
    ["In progress", e.inProgress],
    ["Done", e.done],
    ["Awaiting verify", e.awaitingVerification],
    ["Proven", e.verified],
    ["Dismissed", e.dismissed],
  ] as const;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cells.map(([label, n]) => (
        <div key={label} className="rounded-lg border border-border bg-card p-3 text-center">
          <div className="text-xl font-semibold">{n}</div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}

function ReportQualityBlock({
  projectId,
  rq,
}: {
  projectId: string;
  rq: ReportQualityStatusSummary;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Report quality status</h3>
        <Link href={`/app/projects/${projectId}/trust`} className="text-xs text-primary hover:underline">
          Data trust →
        </Link>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">Sanitize flag</dt>
          <dd>{rq.sanitizeEnabled ? "ON" : "OFF (default)"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Critical block</dt>
          <dd>{rq.blockCriticalEnabled ? "ON" : "OFF (default)"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Errors / warnings</dt>
          <dd>
            {rq.errorCount} / {rq.warningCount}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Latest</dt>
          <dd className="text-xs">
            {rq.latestAt ? new Date(rq.latestAt).toLocaleString() : "None recorded"}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Blocking is never on unless REPORT_QUALITY_BLOCK_CRITICAL=1. Ops panel:{" "}
        <Link href="/app/ops/report-quality" className="text-primary hover:underline">
          /app/ops/report-quality
        </Link>
      </p>
    </div>
  );
}

export function SearchOpsCommandCenterView({ data }: { data: SearchOpsCommandCenter }) {
  const topOps = data.opportunities.slice(0, 8);
  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">SearchOps</p>
        <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Evidence-backed visibility command for {data.projectName} ({data.domain}). Discover →
          Measure → Diagnose → Prioritize → Execute → Verify → Prove.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Visibility snapshot</h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.metrics.map((m) => (
            <MetricCard key={m.id} projectId={data.projectId} m={m} />
          ))}
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold mb-2">Data source health</h2>
          <ul>
            {data.dataSources.map((s) => (
              <SourceRow key={s.id} s={s} />
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <ReportQualityBlock projectId={data.projectId} rq={data.reportQuality} />
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Execution status</h2>
              <Link
                href={`/app/projects/${data.projectId}/proof-ledger`}
                className="text-xs text-primary hover:underline"
              >
                Proof ledger →
              </Link>
            </div>
            <ExecutionStrip e={data.execution} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Top opportunities</h2>
          <Link
            href={`/app/projects/${data.projectId}/opportunities`}
            className="text-sm text-primary hover:underline"
          >
            View all ({data.opportunities.length}) →
          </Link>
        </div>
        {topOps.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-border p-4">
            No evidence-backed opportunities yet. Run a scan or connect GSC to unlock measured
            opportunities. Unavailable signals never appear as zeros.
          </p>
        ) : (
          <ul className="space-y-2">
            {topOps.map((op) => (
              <OpportunityRow key={op.id} projectId={data.projectId} op={op} />
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Generated {new Date(data.generatedAt).toLocaleString()} · No fake metrics · Estimates labeled
        · DataForSEO remains fallback-only
      </p>
    </div>
  );
}
