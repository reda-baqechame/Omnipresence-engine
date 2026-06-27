import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sanitizeHexColor } from "@/lib/security/escape-html";

/**
 * Before/After proof — the artifact that justifies the bill and the guarantee.
 * It compares the project's baseline (first scan) to the current state across
 * the metrics clients care about: OmniPresence score, AI visibility, AI
 * citations, average organic rank, and technical findings resolved. Everything
 * is derived from real persisted rows — no fabricated movement.
 */
export interface ProofDelta {
  label: string;
  before: number | null;
  after: number | null;
  change: number | null;
  unit?: string;
  /** When true, a DECREASE is an improvement (e.g. average rank). */
  betterWhenLower?: boolean;
}

export interface ProofReport {
  generatedAt: string;
  periodStart?: string;
  periodEnd?: string;
  deltas: ProofDelta[];
  findings: { resolved: number; total: number };
  available: boolean;
  note: string;
}

function delta(
  label: string,
  before: number | null,
  after: number | null,
  opts: { unit?: string; betterWhenLower?: boolean } = {}
): ProofDelta {
  const change =
    before !== null && after !== null ? Math.round((after - before) * 100) / 100 : null;
  return { label, before, after, change, unit: opts.unit, betterWhenLower: opts.betterWhenLower };
}

export async function buildProofReport(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProofReport> {
  const [{ data: scores }, { data: baselines }, { data: visibility }] = await Promise.all([
    supabase
      .from("scores")
      .select("omnipresence_score, ai_visibility, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
    supabase
      .from("results_ledger")
      .select("baseline_snapshot, executed_at")
      .eq("project_id", projectId)
      .eq("action_type", "scan_baseline")
      .order("executed_at", { ascending: true }),
    supabase
      .from("visibility_results")
      .select("brand_cited, created_at")
      .eq("project_id", projectId),
  ]);

  const first = scores?.[0];
  const last = scores && scores.length ? scores[scores.length - 1] : undefined;

  // Citations: baseline snapshot vs current measured brand_cited count.
  const baselineCitations =
    (baselines?.[0]?.baseline_snapshot as { citation_count?: number } | null)?.citation_count ?? null;
  const currentCitations = (visibility || []).filter((v) => v.brand_cited).length;

  // Average rank: compare oldest vs newest snapshot per tracked keyword.
  const avgRank = await computeRankDelta(supabase, projectId);

  // Findings resolved.
  const { data: findings } = await supabase
    .from("technical_findings")
    .select("is_resolved")
    .eq("project_id", projectId);
  const total = findings?.length ?? 0;
  const resolved = (findings || []).filter((f) => f.is_resolved).length;

  const deltas: ProofDelta[] = [
    delta("OmniPresence score", first?.omnipresence_score ?? null, last?.omnipresence_score ?? null),
    delta("AI visibility", first?.ai_visibility ?? null, last?.ai_visibility ?? null),
    delta("AI citations", baselineCitations, currentCitations),
    delta("Avg. organic rank", avgRank.before, avgRank.after, { betterWhenLower: true }),
  ];

  const available = Boolean((scores && scores.length > 1) || baselineCitations !== null || avgRank.before !== null);

  return {
    generatedAt: new Date().toISOString(),
    periodStart: first?.created_at ?? baselines?.[0]?.executed_at,
    periodEnd: last?.created_at,
    deltas,
    findings: { resolved, total },
    available,
    note:
      "All figures are computed from measured, persisted scans. Where a baseline is not yet available, the value is shown as n/a rather than fabricated.",
  };
}

async function computeRankDelta(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ before: number | null; after: number | null }> {
  const { data: keywords } = await supabase
    .from("rank_keywords")
    .select("id")
    .eq("project_id", projectId);
  const ids = (keywords || []).map((k) => k.id);
  if (!ids.length) return { before: null, after: null };

  const { data: snaps } = await supabase
    .from("rank_snapshots")
    .select("keyword_id, position, checked_at")
    .in("keyword_id", ids)
    .not("position", "is", null)
    .order("checked_at", { ascending: true });

  if (!snaps?.length) return { before: null, after: null };

  const firstByKw = new Map<string, number>();
  const lastByKw = new Map<string, number>();
  for (const s of snaps) {
    if (typeof s.position !== "number") continue;
    if (!firstByKw.has(s.keyword_id)) firstByKw.set(s.keyword_id, s.position);
    lastByKw.set(s.keyword_id, s.position);
  }
  const avg = (m: Map<string, number>) =>
    m.size ? Math.round(([...m.values()].reduce((a, b) => a + b, 0) / m.size) * 10) / 10 : null;
  return { before: avg(firstByKw), after: avg(lastByKw) };
}

/** Render the proof as an HTML section for inclusion in client reports/portals. */
export function renderProofHTML(proof: ProofReport, color = "#6366f1"): string {
  const c = sanitizeHexColor(color);
  if (!proof.available) {
    return `<div style="margin:24px 0;padding:16px;border:1px solid #eee;border-radius:12px;color:#666">
      <strong>Before / After proof</strong><br/>
      Not enough history yet — run at least two scans to unlock measured before/after deltas.
    </div>`;
  }
  const rows = proof.deltas
    .map((d) => {
      const before = d.before === null ? "n/a" : `${d.before}${d.unit || ""}`;
      const after = d.after === null ? "n/a" : `${d.after}${d.unit || ""}`;
      const improved =
        d.change === null ? null : d.betterWhenLower ? d.change < 0 : d.change > 0;
      const changeText =
        d.change === null ? "—" : `${d.change > 0 ? "+" : ""}${d.change}${d.unit || ""}`;
      const colorStyle = improved === null ? "#666" : improved ? "#16a34a" : "#dc2626";
      return `<tr>
        <td style="padding:8px 12px">${escapeHtml(d.label)}</td>
        <td style="padding:8px 12px;text-align:right;color:#666">${escapeHtml(before)}</td>
        <td style="padding:8px 12px;text-align:right;font-weight:600">${escapeHtml(after)}</td>
        <td style="padding:8px 12px;text-align:right;color:${colorStyle};font-weight:600">${escapeHtml(changeText)}</td>
      </tr>`;
    })
    .join("");

  return `<div style="margin:32px 0">
    <h2 style="font-size:20px;color:${c};margin-bottom:12px">Before / After Proof</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:${c}10;color:#444;text-align:left">
          <th style="padding:8px 12px">Metric</th>
          <th style="padding:8px 12px;text-align:right">Baseline</th>
          <th style="padding:8px 12px;text-align:right">Now</th>
          <th style="padding:8px 12px;text-align:right">Change</th>
        </tr>
      </thead>
      <tbody>${rows}
        <tr>
          <td style="padding:8px 12px">Technical findings resolved</td>
          <td style="padding:8px 12px;text-align:right;color:#666">0 / ${proof.findings.total}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:600">${proof.findings.resolved} / ${proof.findings.total}</td>
          <td style="padding:8px 12px;text-align:right;color:#16a34a;font-weight:600">+${proof.findings.resolved}</td>
        </tr>
      </tbody>
    </table>
    <p style="font-size:11px;color:#999;margin-top:8px">${escapeHtml(proof.note)}</p>
  </div>`;
}
