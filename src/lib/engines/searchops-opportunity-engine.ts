/**
 * SearchOps Opportunity Engine — Market Leader Sprint 1.
 *
 * Turns already-measured project data into evidence-backed opportunities.
 * Never invents metrics. Never calls paid providers. Unavailable stays unavailable.
 */
import type { DataQuality, ExecutionTask, TaskPriority } from "@/types/database";

export type SearchOpsCategory =
  | "ai_visibility"
  | "content"
  | "technical"
  | "gsc"
  | "serp"
  | "authority"
  | "local"
  | "analytics"
  | "report_quality";

export type SearchOpsEvidenceStatus =
  | "measured"
  | "estimated"
  | "unavailable"
  | "model_knowledge"
  | "simulated";

export interface SearchOpsEvidence {
  label: string;
  source: string;
  status: SearchOpsEvidenceStatus;
  confidence: number | null;
  value?: unknown;
  evidenceId?: string | null;
}

export interface SearchOpsOpportunity {
  id: string;
  projectId: string;
  category: SearchOpsCategory;
  title: string;
  diagnosis: string;
  evidence: SearchOpsEvidence[];
  priority: TaskPriority;
  impactType: SearchOpsEvidenceStatus;
  effort: "low" | "medium" | "high";
  recommendedAction: string;
  verificationPlan: string;
  limitations: string[];
}

export interface SearchOpsEngineInput {
  projectId: string;
  brandName?: string;
  /** Grounded AI mention rate 0..1 when measured; null if unavailable. */
  aiMentionRate?: number | null;
  aiSampleSize?: number | null;
  aiDataQuality?: DataQuality | null;
  /** Brand share of voice 0..1 when measured. */
  shareOfVoice?: number | null;
  sovDataQuality?: DataQuality | null;
  technicalFindings?: Array<{
    id?: string;
    severity: string;
    title: string;
    category?: string | null;
    data_quality?: DataQuality | null;
    affected_url?: string | null;
    fix_recommendation?: string | null;
  }>;
  coverageGaps?: Array<{
    id?: string;
    title?: string;
    surface?: string;
    is_present?: boolean;
    data_quality?: DataQuality | null;
  }>;
  /** Pre-computed GSC opportunity rows (from stored insights or mining). */
  gscOpportunities?: Array<{
    kind: "striking_distance" | "low_ctr" | "decay";
    queryOrUrl: string;
    impressions: number;
    clicks?: number;
    ctr?: number;
    position?: number;
    /** Related striking-distance queries sharing the same target URL (page cluster). */
    relatedQueries?: string[];
  }>;
  gscConnected?: boolean;
  authorityReferringDomains?: number | null;
  authorityDataQuality?: DataQuality | null;
  reportQualityErrorCount?: number;
  existingTasks?: Pick<ExecutionTask, "title" | "status">[];
  /**
   * Pre-built opportunities from deep miners (GSC v2, technical, etc.).
   * Merged before quality filter / sort / id-dedupe — same pipeline as built-ins.
   */
  extraOpportunities?: SearchOpsOpportunity[];
}

const GENERIC_TITLE =
  /^(improve seo|boost rankings|increase traffic|optimize website|get more backlinks|rank higher)$/i;

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function dqToStatus(dq: DataQuality | null | undefined): SearchOpsEvidenceStatus {
  if (!dq) return "unavailable";
  if (dq === "measured" || dq === "estimated" || dq === "model_knowledge" || dq === "simulated" || dq === "unavailable") {
    return dq;
  }
  return "unavailable";
}

function effortFromSeverity(severity: string): "low" | "medium" | "high" {
  if (severity === "critical") return "high";
  if (severity === "high") return "medium";
  return "low";
}

function priorityFromSeverity(severity: string): TaskPriority {
  if (severity === "critical") return "critical";
  if (severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

/** Reject generic SEO marketing copy in titles/actions. */
export function isGenericSeoCopy(text: string): boolean {
  return GENERIC_TITLE.test(text.trim());
}

export function assertOpportunityQuality(op: SearchOpsOpportunity): string[] {
  const errors: string[] = [];
  if (!op.evidence.length) errors.push("opportunity must include evidence or unavailable reason");
  if (!op.verificationPlan.trim()) errors.push("verificationPlan required");
  if (!op.recommendedAction.trim()) errors.push("recommendedAction required");
  if (isGenericSeoCopy(op.title) || isGenericSeoCopy(op.recommendedAction)) {
    errors.push("generic SEO copy rejected");
  }
  const hasUnavailableOnly =
    op.evidence.every((e) => e.status === "unavailable") && op.impactType !== "unavailable";
  if (hasUnavailableOnly) {
    errors.push("cannot claim measured/estimated impact when all evidence is unavailable");
  }
  return errors;
}

/**
 * Deterministic opportunity generation from already-loaded project signals.
 * Sort order is stable: priority → category → title.
 */
export function buildSearchOpsOpportunities(input: SearchOpsEngineInput): SearchOpsOpportunity[] {
  const out: SearchOpsOpportunity[] = [];
  const pid = input.projectId;
  const openTitles = new Set(
    (input.existingTasks || [])
      .filter((t) => t.status === "todo" || t.status === "in_progress")
      .map((t) => t.title.toLowerCase())
  );

  // --- AI visibility ---
  const aiDq = dqToStatus(input.aiDataQuality);
  const aiN = input.aiSampleSize ?? 0;
  if (aiDq === "unavailable" || input.aiMentionRate == null || aiN <= 0) {
    const unreliableButPresent = aiN > 0 && input.aiMentionRate == null;
    out.push({
      id: `${pid}:ai_visibility:unavailable`,
      projectId: pid,
      category: "ai_visibility",
      title: unreliableButPresent
        ? "AI visibility rate not reliable enough to report"
        : "AI visibility not measured for this project",
      diagnosis: unreliableButPresent
        ? `${aiN} grounded probe(s) exist but rates are not yet reliable (sample/confidence gate). Mention rate stays unavailable — not zero.`
        : "No grounded AI-visibility probes are available for the latest run. Mention rate cannot be shown as zero.",
      evidence: [
        {
          label: "Grounded AI probes",
          source: "visibility_results",
          status: "unavailable",
          confidence: null,
          value: {
            sampleSize: aiN,
            reason: unreliableButPresent
              ? "probes present but ratesReliable=false"
              : "no measured probes in latest run",
          },
        },
      ],
      priority: "medium",
      impactType: "unavailable",
      effort: "medium",
      recommendedAction: unreliableButPresent
        ? "Run additional grounded visibility probes until the reliability gate passes (typically ≥ 10 grounded samples)."
        : "Run a visibility scan with at least one configured LLM or SERP-grounded probe path.",
      verificationPlan:
        "After the next completed visibility run, confirm grounded sample size ≥ 10 and mention rate is labeled measured.",
      limitations: ["Unavailable is not a measured zero.", "Model-knowledge probes do not count toward headline rates."],
    });
  } else if (input.aiMentionRate < 0.15 && aiN >= 5) {
    out.push({
      id: `${pid}:ai_visibility:low_mention`,
      projectId: pid,
      category: "ai_visibility",
      title: `AI mention rate is ${(input.aiMentionRate * 100).toFixed(1)}% across ${aiN} grounded probes`,
      diagnosis:
        "Brand is rarely cited in measured generative answers for the current prompt set. Prioritize answer-first content and citation-worthy sources.",
      evidence: [
        {
          label: "AI mention rate",
          source: "visibility_results (grounded)",
          status: aiDq === "measured" ? "measured" : aiDq,
          confidence: aiN >= 10 ? 0.85 : 0.55,
          value: { mentionRate: input.aiMentionRate, sampleSize: aiN },
        },
      ],
      priority: input.aiMentionRate < 0.05 ? "critical" : "high",
      impactType: aiDq === "measured" ? "measured" : aiDq,
      effort: "high",
      recommendedAction:
        "Ship answer-first pages for the top unanswered prompts and add citeable facts (stats, definitions, comparisons).",
      verificationPlan:
        "Re-run the same prompt panel; compare grounded mention rate and Wilson CI before vs after. Require measured probes only.",
      limitations: ["Impact on rankings is not guaranteed.", "Sample size below 10 lowers confidence."],
    });
  }

  // --- Share of voice ---
  const sovDq = dqToStatus(input.sovDataQuality);
  if (input.shareOfVoice != null && sovDq === "measured" && input.shareOfVoice < 0.2) {
    out.push({
      id: `${pid}:ai_visibility:low_sov`,
      projectId: pid,
      category: "ai_visibility",
      title: `AI share of voice is ${(input.shareOfVoice * 100).toFixed(1)}% vs competitors`,
      diagnosis: "Competitors capture more weighted AI answer presence on the measured prompt set.",
      evidence: [
        {
          label: "Share of voice",
          source: "share_of_voice engine",
          status: "measured",
          confidence: 0.8,
          value: { shareOfVoice: input.shareOfVoice },
        },
      ],
      priority: "high",
      impactType: "measured",
      effort: "high",
      recommendedAction:
        "Target prompts where competitors are cited and you are absent; publish comparative, source-backed answers.",
      verificationPlan: "Recompute SoV on the same prompt set after content ships; require measured grounded probes.",
      limitations: ["SoV is prompt-set specific, not market-wide."],
    });
  }

  // --- Technical ---
  // Schema findings are owned by searchops-technical-miner (all severities) via
  // extraOpportunities — skip here to avoid duplicate cards.
  for (const f of input.technicalFindings || []) {
    if (f.severity !== "critical" && f.severity !== "high") continue;
    if ((f.category || "").toLowerCase() === "schema") continue;
    const status = dqToStatus(f.data_quality ?? "measured");
    if (status === "unavailable" || status === "simulated") continue;
    const title = f.title?.trim() || "Technical finding";
    if (isGenericSeoCopy(title)) continue;
    const affected = f.affected_url?.trim() || null;
    const fix = f.fix_recommendation?.trim() || null;
    out.push({
      id: `${pid}:technical:${f.id || title.slice(0, 40)}`,
      projectId: pid,
      category: "technical",
      title: `${f.severity === "critical" ? "Critical" : "High"} technical issue: ${title}`,
      diagnosis: `Measured technical audit flagged this as ${f.severity}${f.category ? ` (${f.category})` : ""}${affected ? ` on ${affected}` : ""}.`,
      evidence: [
        {
          label: "Technical finding",
          source: "technical_findings",
          status: status === "estimated" ? "estimated" : "measured",
          confidence: status === "measured" ? 0.9 : 0.6,
          value: { severity: f.severity, category: f.category, affected_url: affected },
          evidenceId: f.id ?? null,
        },
      ],
      priority: priorityFromSeverity(f.severity),
      impactType: status === "estimated" ? "estimated" : "measured",
      effort: effortFromSeverity(f.severity),
      recommendedAction: fix
        ? `${fix}${affected ? ` Affected URL: ${affected}.` : ""} Then re-run technical audit.`
        : `Fix “${title}”${affected ? ` on ${affected}` : " on the affected URLs"}, then re-run technical audit.`,
      verificationPlan: "Re-scan technical audit; confirm finding severity drops or finding is resolved.",
      limitations: ["Fixing a finding does not guarantee ranking change."],
    });
  }

  // --- Content / coverage gaps ---
  for (const c of (input.coverageGaps || []).slice(0, 12)) {
    if (c.is_present) continue;
    const status = dqToStatus(c.data_quality ?? "measured");
    if (status === "unavailable") continue;
    const label = c.title || c.surface || "Coverage gap";
    if (isGenericSeoCopy(label)) continue;
    out.push({
      id: `${pid}:content:${c.id || label.slice(0, 40)}`,
      projectId: pid,
      category: "content",
      title: `Missing coverage: ${label}`,
      diagnosis: "Coverage check shows this surface/topic is not present for the brand.",
      evidence: [
        {
          label: "Coverage item",
          source: "coverage_items",
          status: status === "model_knowledge" ? "model_knowledge" : status,
          confidence: status === "measured" ? 0.75 : 0.45,
          value: { surface: c.surface, is_present: false },
          evidenceId: c.id ?? null,
        },
      ],
      priority: status === "measured" ? "medium" : "low",
      impactType: status,
      effort: "medium",
      recommendedAction: `Create or claim presence for “${label}” with a verifiable URL.`,
      verificationPlan: "Re-run coverage check; item must flip to present with a measured URL.",
      limitations: ["Presence alone is not a ranking guarantee."],
    });
  }

  // --- GSC / SERP ---
  // First-party GSC impressions/CTR require OAuth. Rank-tracker striking distance and
  // cannibalization (extraOpportunities) are measured SERP signals and must still surface
  // when GSC is disconnected — otherwise professionals only see a partial story.
  if (input.gscConnected === false) {
    out.push({
      id: `${pid}:gsc:disconnected`,
      projectId: pid,
      category: "gsc",
      title: "Google Search Console not connected",
      diagnosis:
        "First-party query/page impressions, CTR, and decay opportunities are unavailable until GSC OAuth is connected. Rank-tracker SERP opportunities (striking distance, cannibalization) still appear when measured.",
      evidence: [
        {
          label: "GSC connection",
          source: "oauth_connectors",
          status: "unavailable",
          confidence: null,
          value: { connected: false },
        },
      ],
      priority: "high",
      impactType: "unavailable",
      effort: "low",
      recommendedAction: "Connect Google Search Console for this project under Search Console settings.",
      verificationPlan:
        "After connect + sync, GSC totals, low-CTR, and decay lists must show measured rows; rank SERP opportunities remain available either way.",
      limitations: [
        "No impressions/CTR/decay opportunities can be invented while disconnected.",
        "Rank-tracker positions are measured SERP snapshots, not GSC impressions.",
      ],
    });
  }

  for (const g of (input.gscOpportunities || []).slice(0, 15)) {
    if (g.kind === "striking_distance") {
      const hasImpr = (g.impressions ?? 0) > 0;
      // Impression volume requires GSC; rank-only strike still surfaces as SERP.
      if (hasImpr && input.gscConnected === false) continue;
      out.push({
        id: `${pid}:gsc:strike:${g.queryOrUrl}`,
        projectId: pid,
        category: hasImpr ? "gsc" : "serp",
        title: `Striking distance: “${g.queryOrUrl}” at position ${g.position?.toFixed?.(1) ?? g.position}`,
        diagnosis: hasImpr
          ? `Query has ${g.impressions} impressions with position ${g.position} (measured first-party/GSC).`
          : `Keyword is measured at position ${g.position} (rank tracker) — striking distance 4–20. Impression volume unavailable without GSC sync.`,
        evidence: [
          {
            label: hasImpr ? "GSC / first-party query performance" : "Rank tracker position",
            source: hasImpr ? "Google Search Console" : "rank_keywords",
            status: "measured",
            confidence: hasImpr ? 0.95 : 0.8,
            value: {
              impressions: g.impressions || null,
              clicks: g.clicks ?? null,
              position: g.position,
              ctr: g.ctr ?? null,
              relatedQueries: g.relatedQueries?.length ? g.relatedQueries : undefined,
            },
          },
        ],
        priority: hasImpr && g.impressions >= 200 ? "high" : "medium",
        impactType: "measured",
        effort: "medium",
        recommendedAction: `Improve the ranking URL for “${g.queryOrUrl}” (title/intent match, answer-first intro) without inventing traffic forecasts.`,
        verificationPlan: hasImpr
          ? "Compare GSC position and CTR for this query over the next 28-day window after publish."
          : "Re-check rank_keywords.last_position for this keyword after changes; optionally connect GSC for impression proof.",
        limitations: [
          "Position improvement is not guaranteed.",
          "Impact estimates are not fabricated.",
          ...(hasImpr ? [] : ["Impressions unavailable — do not invent volume."]),
          ...(g.relatedQueries && g.relatedQueries.length > 1
            ? [`Page/query cluster: ${g.relatedQueries.length} striking-distance queries share this target URL.`]
            : []),
        ],
      });
    } else if (g.kind === "low_ctr") {
      // low_CTR requires measured GSC impressions — skip when disconnected.
      if (input.gscConnected === false || !(g.impressions > 0)) continue;
      out.push({
        id: `${pid}:gsc:lowctr:${g.queryOrUrl}`,
        projectId: pid,
        category: "gsc",
        title: `Low CTR vs expected: “${g.queryOrUrl}”`,
        diagnosis: `Measured CTR ${(g.ctr != null ? (g.ctr * 100).toFixed(2) : "?")}% with ${g.impressions} impressions — below expected CTR for position ${g.position}.`,
        evidence: [
          {
            label: "GSC CTR vs position",
            source: "Google Search Console",
            status: "measured",
            confidence: 0.95,
            value: { impressions: g.impressions, ctr: g.ctr, position: g.position },
          },
          {
            label: "Expected CTR heuristic",
            source: "position CTR model",
            status: "model_knowledge",
            confidence: 0.5,
            value: { note: "Expected CTR is a heuristic for prioritization only." },
          },
        ],
        priority: "medium",
        // Measured CTR/position; expected-CTR gap impact is model_knowledge, not measured lift.
        impactType: "model_knowledge",
        effort: "low",
        recommendedAction: `Rewrite title/meta for the ranking URL of “${g.queryOrUrl}” to match query intent; keep claims factual.`,
        verificationPlan: "Re-check GSC CTR for the same query after 14–28 days; require measured impressions ≥ 50.",
        limitations: ["CTR benchmarks are heuristics for prioritization, not guarantees."],
      });
    } else if (g.kind === "decay") {
      if (input.gscConnected === false || !(g.impressions > 0)) continue;
      out.push({
        id: `${pid}:gsc:decay:${g.queryOrUrl}`,
        projectId: pid,
        category: "gsc",
        title: `Impression decay: ${g.queryOrUrl}`,
        diagnosis: `Page impressions dropped in the latest 28d vs prior 28d (measured GSC).`,
        evidence: [
          {
            label: "GSC page decay",
            source: "Google Search Console",
            status: "measured",
            confidence: 0.9,
            value: { impressions: g.impressions, clicks: g.clicks },
          },
        ],
        priority: "medium",
        impactType: "measured",
        effort: "medium",
        recommendedAction: `Refresh the decaying page with updated facts, clearer answer structure, and internal links.`,
        verificationPlan: "Compare GSC impressions for the URL current vs prior 28d after refresh.",
        limitations: ["Decay can be seasonal; verify against prior year if available."],
      });
    }
  }

  // --- Authority ---
  const authDq = dqToStatus(input.authorityDataQuality);
  if (authDq === "unavailable" || input.authorityReferringDomains == null) {
    out.push({
      id: `${pid}:authority:unavailable`,
      projectId: pid,
      category: "authority",
      title: "Referring-domain data unavailable",
      diagnosis: "No sovereign backlink index result for this domain — cannot show zero referring domains.",
      evidence: [
        {
          label: "Referring domains",
          source: "OmniData webgraph / backlinks router",
          status: "unavailable",
          confidence: null,
        },
      ],
      priority: "low",
      impactType: "unavailable",
      effort: "low",
      recommendedAction: "Enable OmniData Common Crawl webgraph or wait for ingest; do not treat missing data as zero.",
      verificationPlan: "fetchBacklinks must return measured referring domains with provenance.",
      limitations: ["Paid indexes remain fallback-only until benchmark-proven."],
    });
  }

  // --- Report quality ---
  if ((input.reportQualityErrorCount ?? 0) > 0) {
    out.push({
      id: `${pid}:report_quality:errors`,
      projectId: pid,
      category: "report_quality",
      title: `${input.reportQualityErrorCount} report-quality error(s) recorded`,
      diagnosis: "Internal quality gate logged trust-breaking claim issues on recent reports.",
      evidence: [
        {
          label: "report_quality_violations",
          source: "report_quality_gate",
          status: "measured",
          confidence: 1,
          value: { errorCount: input.reportQualityErrorCount },
        },
      ],
      priority: "high",
      impactType: "measured",
      effort: "medium",
      recommendedAction: "Review violations in ops report-quality panel; fix claim sources before client delivery.",
      verificationPlan: "Regenerate report; error-severity violations for the same claim_ids must not recur.",
      limitations: ["Blocking is only active when REPORT_QUALITY_BLOCK_CRITICAL=1."],
    });
  }

  // Deep miners (GSC v2, technical, etc.) — same quality pipeline as built-ins.
  for (const extra of input.extraOpportunities || []) {
    out.push(extra);
  }

  // Drop duplicates already open as tasks (title match) and invalid generics.
  const filtered = out.filter((op) => {
    if (openTitles.has(op.title.toLowerCase())) return false;
    const errs = assertOpportunityQuality(op);
    return errs.length === 0;
  });

  // Deterministic id dedupe (first wins) — miners + built-ins share one namespace.
  const byId = new Map<string, SearchOpsOpportunity>();
  for (const op of filtered) {
    if (!byId.has(op.id)) byId.set(op.id, op);
  }

  return [...byId.values()].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pd !== 0) return pd;
    const cd = a.category.localeCompare(b.category);
    if (cd !== 0) return cd;
    return a.title.localeCompare(b.title);
  });
}

/** Map opportunity → execution task draft fields (caller inserts). */
export function opportunityToTaskDraft(op: SearchOpsOpportunity): {
  title: string;
  description: string;
  source_module: "searchops_opportunity";
  source_id: string;
  category: string;
  priority: TaskPriority;
  impact: number;
  effort: number;
  evidence: Record<string, unknown>;
  before_metric: Record<string, unknown>;
} {
  const impact =
    op.priority === "critical" ? 90 : op.priority === "high" ? 70 : op.priority === "medium" ? 50 : 30;
  const effort = op.effort === "high" ? 8 : op.effort === "medium" ? 3 : 1;
  const primaryEvidence = op.evidence[0]?.value;
  return {
    title: op.title,
    description: `${op.diagnosis}\n\nAction: ${op.recommendedAction}\n\nVerify: ${op.verificationPlan}`,
    source_module: "searchops_opportunity",
    source_id: op.id,
    category: op.category,
    priority: op.priority,
    impact,
    effort,
    evidence: {
      searchops_opportunity_id: op.id,
      impact_type: op.impactType,
      evidence: op.evidence,
      limitations: op.limitations,
      verification_plan: op.verificationPlan,
      recommended_action: op.recommendedAction,
    },
    before_metric: {
      captured_at: new Date().toISOString(),
      impact_type: op.impactType,
      primary_evidence: primaryEvidence ?? null,
      evidence_statuses: op.evidence.map((e) => e.status),
    },
  };
}
