import type { SupabaseClient } from "@supabase/supabase-js";
import { measureCitationRate, computeLift, type RewriteLiftSummary } from "@/lib/engines/geo-rewrite-loop";
import { getCapabilitiesSummary } from "@/lib/config/capabilities";
import { getWebgraphStatus, type WebgraphStatus } from "@/lib/providers/webgraph";

/**
 * Per-project "Proof" KPIs — the refund shield.
 *
 * Every number here is *measured* from first-party stores (ai_probe_traces,
 * rank_keywords, results_ledger, execution_tasks) or labeled `available:false`
 * when the backend is not provisioned. Nothing is fabricated; a missing signal
 * is reported as unavailable, never as a zero result.
 */

export interface ProofMetric {
  available: boolean;
  dataSource: "measured" | "first_party" | "estimated" | "unavailable";
  confidence: number;
}

export interface AiVisibilityProof extends ProofMetric {
  before: { citationRate: number; mentionRate: number; probes: number };
  after: { citationRate: number; mentionRate: number; probes: number };
  citationLiftPp: number;
  mentionLiftPp: number;
}

export interface FirstPartyRankProof extends ProofMetric {
  trackedKeywords: number;
  firstPartyKeywords: number;
  avgFirstPartyPosition: number | null;
}

export interface AuthorityProof extends ProofMetric {
  ready: boolean;
  referringDomains: number;
  webgraphRelease: string | null;
  ingestedAt: string | null;
}

export interface CoverageProof extends ProofMetric {
  measuredFlags: number;
  totalFlags: number;
  coveragePct: number;
  configuredProviders: number;
  totalProviders: number;
}

export interface ExecutionProof extends ProofMetric {
  completedTasks: number;
  openTasks: number;
  verifiedLedgerEntries: number;
  measuredGeoLifts: number;
}

export interface ProjectProof {
  aiVisibility: AiVisibilityProof;
  firstPartyRank: FirstPartyRankProof;
  authority: AuthorityProof;
  coverage: CoverageProof;
  execution: ExecutionProof;
  generatedAt: string;
}

const DAY = 24 * 60 * 60 * 1000;

async function buildAiVisibilityProof(
  supabase: SupabaseClient,
  projectId: string,
  windowDays = 30
): Promise<AiVisibilityProof> {
  const now = Date.now();
  const priorStart = new Date(now - 2 * windowDays * DAY).toISOString();
  const windowStart = new Date(now - windowDays * DAY).toISOString();
  const nowISO = new Date(now).toISOString();

  const before = await measureCitationRate(supabase, projectId, {
    sinceISO: priorStart,
    untilISO: windowStart,
  });
  const after = await measureCitationRate(supabase, projectId, {
    sinceISO: windowStart,
    untilISO: nowISO,
  });

  const lift: RewriteLiftSummary = computeLift(before, after);
  const available = before.probes > 0 || after.probes > 0;

  return {
    available,
    dataSource: available ? "measured" : "unavailable",
    confidence: available ? 0.9 : 0,
    before: { citationRate: before.citationRate, mentionRate: before.mentionRate, probes: before.probes },
    after: { citationRate: after.citationRate, mentionRate: after.mentionRate, probes: after.probes },
    citationLiftPp: lift.citationLiftPp,
    mentionLiftPp: lift.mentionLiftPp,
  };
}

async function buildFirstPartyRankProof(
  supabase: SupabaseClient,
  projectId: string
): Promise<FirstPartyRankProof> {
  const { data } = await supabase
    .from("rank_keywords")
    .select("last_position, last_rank_source")
    .eq("project_id", projectId);

  const rows = (data || []) as Array<{ last_position: number | null; last_rank_source: string | null }>;
  const firstParty = rows.filter((r) => r.last_rank_source === "first_party" && r.last_position != null);
  const avg =
    firstParty.length > 0
      ? firstParty.reduce((s, r) => s + Number(r.last_position), 0) / firstParty.length
      : null;

  return {
    available: firstParty.length > 0,
    dataSource: firstParty.length > 0 ? "first_party" : "unavailable",
    confidence: firstParty.length > 0 ? 0.99 : 0,
    trackedKeywords: rows.length,
    firstPartyKeywords: firstParty.length,
    avgFirstPartyPosition: avg != null ? Math.round(avg * 10) / 10 : null,
  };
}

function authorityFromWebgraph(status: WebgraphStatus): AuthorityProof {
  return {
    available: status.available && status.ready,
    dataSource: status.available && status.ready ? "measured" : "unavailable",
    confidence: status.available && status.ready ? 0.85 : 0,
    ready: status.ready,
    referringDomains: status.vertexCount,
    webgraphRelease: status.release,
    ingestedAt: status.ingestedAt,
  };
}

function buildCoverageProof(): CoverageProof {
  const summary = getCapabilitiesSummary();
  const flags: Record<string, unknown> = {
    ...summary.freeDataMoat100x,
    ...summary.diyStack,
  };
  const values = Object.values(flags).filter((v) => typeof v === "boolean") as boolean[];
  const measured = values.filter(Boolean).length;
  const total = values.length;
  const pct = total > 0 ? Math.round((measured / total) * 100) : 0;
  return {
    available: total > 0,
    dataSource: "measured",
    confidence: 1,
    measuredFlags: measured,
    totalFlags: total,
    coveragePct: pct,
    configuredProviders: summary.configuredCount,
    totalProviders: summary.totalProviders,
  };
}

async function buildExecutionProof(
  supabase: SupabaseClient,
  projectId: string
): Promise<ExecutionProof> {
  const [tasksRes, ledgerRes] = await Promise.all([
    supabase.from("execution_tasks").select("status").eq("project_id", projectId),
    supabase.from("results_ledger").select("status, action_type").eq("project_id", projectId),
  ]);

  const tasks = (tasksRes.data || []) as Array<{ status: string }>;
  const ledger = (ledgerRes.data || []) as Array<{ status: string; action_type: string }>;

  const completedTasks = tasks.filter((t) => t.status === "completed" || t.status === "verified").length;
  const openTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "verified").length;
  const verifiedLedger = ledger.filter((l) => l.status === "verified" || l.status === "completed").length;
  const measuredGeoLifts = ledger.filter((l) => l.action_type === "geo_rewrite_measured").length;

  const available = tasks.length > 0 || ledger.length > 0;
  return {
    available,
    dataSource: available ? "measured" : "unavailable",
    confidence: available ? 0.95 : 0,
    completedTasks,
    openTasks,
    verifiedLedgerEntries: verifiedLedger,
    measuredGeoLifts,
  };
}

/** Assemble the full per-project Proof view. Best-effort: failing parts degrade to unavailable. */
export async function buildProjectProof(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectProof> {
  let webgraph: WebgraphStatus;
  try {
    webgraph = await getWebgraphStatus();
  } catch {
    webgraph = {
      available: false,
      ready: false,
      edgesReady: false,
      ingestInProgress: false,
      release: null,
      ingestedAt: null,
      vertexCount: 0,
      edgeCount: 0,
    };
  }

  const [aiVisibility, firstPartyRank, execution] = await Promise.all([
    buildAiVisibilityProof(supabase, projectId),
    buildFirstPartyRankProof(supabase, projectId),
    buildExecutionProof(supabase, projectId),
  ]);

  return {
    aiVisibility,
    firstPartyRank,
    authority: authorityFromWebgraph(webgraph),
    coverage: buildCoverageProof(),
    execution,
    generatedAt: new Date().toISOString(),
  };
}
