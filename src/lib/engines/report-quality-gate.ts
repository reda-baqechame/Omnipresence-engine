/**
 * Patch F.1a/F.1b — report-wide claim inventory + validator (logging/telemetry only).
 */
import type { ReportData } from "@/lib/engines/report-generator";
import type { IntelligenceReport, ReportDataQuality } from "@/types/intelligence-report";
import type {
  AuthorityOpportunity,
  CoverageItem,
  DataQuality,
  RoadmapItem,
  TechnicalFinding,
  VisibilityResult,
} from "@/types/database";
import { findForbiddenClaims } from "@/lib/config/claims";
import { calculateShareOfVoice } from "@/lib/engines/share-of-voice";
import type { ReportNarrative } from "@/lib/engines/intelligence-report-narrative";

export type ClaimClassification =
  | "measured"
  | "estimated"
  | "model_knowledge"
  | "simulated"
  | "unavailable";

export type ReportClaimSeverity = "info" | "warning" | "error";

export interface ReportClaimViolation {
  claimId: string;
  section: string;
  claimType: string;
  field: string;
  reason: string;
  severity: ReportClaimSeverity;
}

export interface ReportClaimInventoryItem {
  claimId: string;
  section: string;
  claimType: string;
  field: string;
  value: unknown;
  classification: ClaimClassification;
  evidencePointer?: string | null;
  sourceLabel?: string | null;
  customerVisibleText?: string | null;
}

export interface ReportQualityValidationResult {
  passed: boolean;
  violations: ReportClaimViolation[];
  inventory: ReportClaimInventoryItem[];
}

export interface ValidateReportClaimsOptions {
  narrative?: ReportNarrative;
}

const GENERIC_UNSUPPORTED_PHRASES = [
  "improve seo",
  "boost visibility",
  "drive more traffic",
  "increase rankings",
  "optimize content",
  "build authority",
  "enhance performance",
] as const;

const ESTIMATE_LABEL_RE =
  /\bestimat(e|ed|ing)\b|industry estimate|model estimate|industry-average|industry average/i;

const QUANTIFIED_PROJECTION_RE =
  /\$\s*\d|%\s*(increase|growth|lift|improvement)|\b\d+\s*(sessions|clicks|visits|rankings?)\b/i;

const MEANINGLESS_SOURCE_LABELS = new Set([
  "measured",
  "estimated",
  "unavailable",
  "null",
  "industry_estimate",
  "real",
  "estimated_proxy",
  "not_available",
]);

const SELF_REF_EVIDENCE_RE =
  /^executive\.keyFindings\[\d+\]$|^roadmap(\.items|Items)\[\d+\]$/;

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown";
}

function isIntelligenceReport(report: ReportData | IntelligenceReport): report is IntelligenceReport {
  return (
    ("meta" in report && report.meta != null) ||
    ("executive" in report && report.executive != null)
  );
}

function mapDataQuality(dq?: DataQuality | ReportDataQuality | null): ClaimClassification {
  if (!dq) return "unavailable";
  switch (dq) {
    case "measured":
      return "measured";
    case "estimated":
    case "estimated_proxy":
      return "estimated";
    case "model_knowledge":
      return "model_knowledge";
    case "simulated":
      return "simulated";
    case "unavailable":
    case "not_available":
      return "unavailable";
    default:
      return "unavailable";
  }
}

function pushClaim(items: ReportClaimInventoryItem[], item: ReportClaimInventoryItem): void {
  items.push(item);
}

function hasEstimateLabel(text?: string | null, sourceLabel?: string | null): boolean {
  const combined = [text, sourceLabel].filter(Boolean).join(" ");
  return ESTIMATE_LABEL_RE.test(combined);
}

function isZeroLikeValue(value: unknown): boolean {
  if (value === 0 || value === "0") return true;
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "$0" || t === "0%" || t === "0.0%" || t === "—" || t === "N/A") return true;
    if (/^\$0(\.00)?$/.test(t)) return true;
    if (/^0%$/.test(t)) return true;
  }
  return false;
}

function findGenericUnsupportedPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return GENERIC_UNSUPPORTED_PHRASES.filter((p) => lower.includes(p));
}

function isSelfReferentialEvidence(pointer: string | null | undefined): boolean {
  if (!pointer) return false;
  return SELF_REF_EVIDENCE_RE.test(pointer);
}

function isValidEvidencePointer(
  pointer: string | null | undefined,
  claimType: string
): boolean {
  if (!pointer) return false;
  if (isSelfReferentialEvidence(pointer)) return false;
  if (claimType === "technical_recommendation" && pointer.startsWith("technical_findings:")) {
    return false;
  }
  return true;
}

function classifyRoadmapItem(item: RoadmapItem): ClaimClassification {
  const hasEvidence = Boolean(item.evidence_label || item.evidence_url || item.source_type);
  if (hasEvidence) return "measured";
  const text = `${item.title} ${item.description}`;
  if (ESTIMATE_LABEL_RE.test(text) || QUANTIFIED_PROJECTION_RE.test(text)) return "estimated";
  return "model_knowledge";
}

function requiresEstimateLabelRule(item: ReportClaimInventoryItem): boolean {
  if (item.claimType === "ads_replacement_value" || item.claimType === "cpc_source") {
    return item.classification === "estimated";
  }
  if (item.classification !== "estimated") return false;
  if (item.claimType === "roadmap_item") {
    const text = item.customerVisibleText ?? "";
    return ESTIMATE_LABEL_RE.test(text) || QUANTIFIED_PROJECTION_RE.test(text);
  }
  if (
    item.claimType === "ai_visibility_rate" ||
    item.claimType === "keyword_opportunity" ||
    item.claimType === "serp_rank" ||
    item.claimType === "visibility_sov"
  ) {
    return true;
  }
  return QUANTIFIED_PROJECTION_RE.test(item.customerVisibleText ?? "");
}

function inventoryTechnicalFinding(
  items: ReportClaimInventoryItem[],
  f: TechnicalFinding,
  idx: number,
  prefix: string
): void {
  pushClaim(items, {
    claimId: `${prefix}.finding.${f.id}`,
    section: "technical",
    claimType: "technical_finding",
    field: `${prefix}[${idx}].title`,
    value: f.title,
    classification: mapDataQuality(f.data_source),
    evidencePointer: `technical_findings:${f.id}`,
    sourceLabel: f.provider ?? null,
    customerVisibleText: f.description,
  });

  const recommendation = f.fix_recommendation?.trim();
  if (recommendation) {
    pushClaim(items, {
      claimId: `${prefix}.recommendation.${f.id}`,
      section: "technical",
      claimType: "technical_recommendation",
      field: `${prefix}[${idx}].fix_recommendation`,
      value: recommendation,
      classification: f.provider ? "model_knowledge" : "model_knowledge",
      evidencePointer: f.provider ? `technical_findings:${f.id}:provider` : null,
      sourceLabel: f.provider ?? "technical analysis",
      customerVisibleText: recommendation,
    });
  }
}

function inventoryShareOfVoice(
  items: ReportClaimInventoryItem[],
  report: ReportData | IntelligenceReport
): void {
  const results = report.visibilityResults;
  if (!results.length) return;

  const project = "project" in report ? report.project : report.meta.project;
  const sov = calculateShareOfVoice(results, project.name, project.competitors || []);

  pushClaim(items, {
    claimId: "visibility.sov",
    section: "visibility",
    claimType: "visibility_sov",
    field: "shareOfVoice.brand",
    value: sov.brand?.shareOfVoice ?? null,
    classification: sov.sampleSize > 0 && sov.brand ? "measured" : "unavailable",
    evidencePointer: sov.sampleSize > 0 ? `visibility_results:sov:n=${sov.sampleSize}` : null,
    sourceLabel: sov.sampleSize > 0 ? "prominence-weighted share-of-voice" : "no measured probes",
    customerVisibleText:
      sov.brand != null
        ? `Share of voice ${Math.round(sov.brand.shareOfVoice * 100)}% (${sov.sampleSize} probes)`
        : "Share of voice unavailable",
  });

  for (const entry of sov.leaderboard.slice(0, 10)) {
    pushClaim(items, {
      claimId: `visibility.sov.${slugPart(entry.name)}`,
      section: "visibility",
      claimType: "visibility_sov_competitor",
      field: `shareOfVoice.${entry.name}`,
      value: entry.shareOfVoice,
      classification: sov.sampleSize > 0 ? "measured" : "unavailable",
      evidencePointer: sov.sampleSize > 0 ? `visibility_results:sov:n=${sov.sampleSize}` : null,
      sourceLabel: "prominence-weighted share-of-voice",
      customerVisibleText: `${entry.name}: ${Math.round(entry.shareOfVoice * 100)}% SOV`,
    });
  }
}

function inventoryVisibilityResult(
  items: ReportClaimInventoryItem[],
  vr: VisibilityResult,
  idx: number
): void {
  pushClaim(items, {
    claimId: `visibility.probe.${vr.id}`,
    section: "visibility",
    claimType: "visibility_probe",
    field: `visibilityResults[${idx}].brand_mentioned`,
    value: vr.brand_mentioned,
    classification: mapDataQuality(vr.data_source),
    evidencePointer: `visibility_results:${vr.id}`,
    sourceLabel: vr.engine,
  });
}

function inventoryCoverageItem(items: ReportClaimInventoryItem[], c: CoverageItem, idx: number): void {
  const dq = c.data_quality ?? c.data_source;
  pushClaim(items, {
    claimId: `coverage.item.${c.id}`,
    section: "coverage",
    claimType: "coverage_gap",
    field: `coverageItems[${idx}].platform_name`,
    value: c.platform_name,
    classification: c.is_present ? mapDataQuality(dq) : "unavailable",
    evidencePointer: c.measured ? `coverage_items:${c.id}` : null,
    sourceLabel: dq && !MEANINGLESS_SOURCE_LABELS.has(dq) ? dq : c.measured ? "coverage lookup" : null,
    customerVisibleText: c.notes,
  });
}

function inventoryRoadmapItem(items: ReportClaimInventoryItem[], item: RoadmapItem, idx: number): void {
  const classification = classifyRoadmapItem(item);
  const hasEvidence = Boolean(item.evidence_label || item.evidence_url || item.source_type);
  pushClaim(items, {
    claimId: `roadmap.item.${idx}`,
    section: "roadmap",
    claimType: "roadmap_item",
    field: `roadmapItems[${idx}].title`,
    value: item.title,
    classification,
    evidencePointer: hasEvidence
      ? item.evidence_url ?? (item.source_type ? `roadmap:${item.source_type}` : null)
      : null,
    sourceLabel: item.evidence_label ?? item.source_type ?? null,
    customerVisibleText: `${item.title}: ${item.description}`,
  });
}

function inventoryIntelligenceSection(
  items: ReportClaimInventoryItem[],
  report: IntelligenceReport
): void {
  const { proof, ppc, entity, schema, community, reputation, methodology } = report;

  if (proof.available || proof.proofHtml) {
    pushClaim(items, {
      claimId: "proof.summary",
      section: "proof",
      claimType: "proof_summary",
      field: "proof.proofHtml",
      value: proof.proofHtml ? "present" : proof.deliverablesMet,
      classification: proof.available ? mapDataQuality(proof.dataQuality) : "unavailable",
      evidencePointer: proof.proofHtml ? "proof_report" : null,
      sourceLabel: proof.available ? "proof ledger" : null,
      customerVisibleText: proof.proofHtml ? "Before/after proof section" : null,
    });
  }

  if (ppc.available) {
    pushClaim(items, {
      claimId: "intelligence.ppc",
      section: "ppc",
      claimType: "ppc_intelligence",
      field: "ppc.competitorAdCount",
      value: ppc.competitorAdCount,
      classification: mapDataQuality(ppc.dataQuality),
      evidencePointer: ppc.competitorAdCount > 0 ? "ppc_intelligence" : null,
      sourceLabel: ppc.dataQuality,
      customerVisibleText: ppc.highlights.join("; ") || null,
    });
  }

  if (entity.available) {
    pushClaim(items, {
      claimId: "intelligence.entity",
      section: "entity",
      claimType: "entity_presence",
      field: "entity.sameAsCount",
      value: entity.sameAsCount,
      classification: mapDataQuality(entity.dataQuality),
      evidencePointer: "entity_graph",
      sourceLabel: entity.dataQuality,
      customerVisibleText: entity.gaps.join("; ") || null,
    });
  }

  if (schema.available) {
    pushClaim(items, {
      claimId: "intelligence.schema",
      section: "schema",
      claimType: "schema_deployments",
      field: "schema.deployments",
      value: schema.deployments,
      classification: mapDataQuality(schema.dataQuality),
      evidencePointer: "schema_audit",
      sourceLabel: schema.dataQuality,
      customerVisibleText: schema.issues.join("; ") || null,
    });
  }

  if (community.available) {
    pushClaim(items, {
      claimId: "intelligence.community",
      section: "community",
      claimType: "community_mentions",
      field: "community.totalMentions",
      value: community.totalMentions,
      classification: mapDataQuality(community.dataQuality),
      evidencePointer: "community_mentions",
      sourceLabel: community.dataQuality,
    });
  }

  if (reputation.available) {
    pushClaim(items, {
      claimId: "intelligence.reputation",
      section: "reputation",
      claimType: "reputation_signals",
      field: "reputation.newsMentions",
      value: reputation.newsMentions,
      classification: mapDataQuality(reputation.dataQuality),
      evidencePointer: "reputation_scan",
      sourceLabel: reputation.dataQuality,
      customerVisibleText: reputation.highlights.join("; ") || null,
    });
  }

  if (methodology.available) {
    pushClaim(items, {
      claimId: "intelligence.methodology",
      section: "methodology",
      claimType: "methodology_limitations",
      field: "methodology.disclaimers",
      value: methodology.disclaimers.length,
      classification: "measured",
      evidencePointer: "methodology_appendix",
      sourceLabel: "approved methodology copy",
      customerVisibleText: methodology.disclaimers.join("; ") || null,
    });
  }
}

function inventoryNarrativeSections(
  items: ReportClaimInventoryItem[],
  narrative?: ReportNarrative
): void {
  if (!narrative) return;
  for (const [section, text] of Object.entries(narrative)) {
    if (!text?.trim()) continue;
    pushClaim(items, {
      claimId: `narrative.${section}`,
      section: "narrative",
      claimType: "narrative_section",
      field: `narrative.${section}`,
      value: text,
      classification: "model_knowledge",
      evidencePointer: null,
      sourceLabel: "report narrative",
      customerVisibleText: text,
    });
  }
}

function inventoryStandardReport(report: ReportData, items: ReportClaimInventoryItem[]): void {
  if (!report.score) return;
  const { score } = report;
  const breakdown = score.breakdown as
    | { dimension_availability?: Record<string, boolean> }
    | undefined;
  const dimAvail = breakdown?.dimension_availability ?? {};

  pushClaim(items, {
    claimId: "score.overall",
    section: "score",
    claimType: "overall_score",
    field: "omnipresence_score",
    value: score.omnipresence_score,
    classification: mapDataQuality(score.data_source),
    evidencePointer: score.data_source === "measured" ? `scores:${score.id}` : null,
    sourceLabel:
      score.data_source === "measured"
        ? "OmniPresence scoring engine"
        : score.data_source === "estimated"
          ? "estimated composite"
          : null,
  });

  const subScoreFields: Array<{ key: keyof typeof score; label: string }> = [
    { key: "ai_visibility", label: "ai_visibility" },
    { key: "search_visibility", label: "search_visibility" },
    { key: "local_visibility", label: "local_visibility" },
    { key: "social_presence", label: "social_presence" },
    { key: "directory_coverage", label: "directory_coverage" },
    { key: "authority_mentions", label: "authority_mentions" },
    { key: "technical_readiness", label: "technical_readiness" },
    { key: "conversion_readiness", label: "conversion_readiness" },
  ];

  for (const { key, label } of subScoreFields) {
    const available = dimAvail[label] !== false;
    const rawValue = score[key] as number;
    pushClaim(items, {
      claimId: `score.subscore.${label}`,
      section: "score",
      claimType: "subscore",
      field: label,
      value: rawValue,
      classification: available ? mapDataQuality(score.data_source) : "unavailable",
      evidencePointer: available && score.data_source === "measured" ? `scores:${score.id}#${label}` : null,
      sourceLabel: available
        ? score.data_source === "measured"
          ? "OmniPresence scoring engine"
          : score.data_source && !MEANINGLESS_SOURCE_LABELS.has(score.data_source)
            ? score.data_source
            : null
        : "dimension unavailable",
    });
  }

  if (report.visibilityResults.length === 0) {
    pushClaim(items, {
      claimId: "visibility.aggregate",
      section: "visibility",
      claimType: "ai_visibility",
      field: "visibilityResults",
      value: null,
      classification: "unavailable",
      sourceLabel: "no visibility probes",
    });
  } else {
    const measuredCount = report.visibilityResults.filter((v) => v.data_source === "measured").length;
    pushClaim(items, {
      claimId: "visibility.aggregate",
      section: "visibility",
      claimType: "ai_visibility_aggregate",
      field: "visibilityResults.length",
      value: report.visibilityResults.length,
      classification: measuredCount > 0 ? "measured" : "estimated",
      evidencePointer: `visibility_results:${report.visibilityResults.length}`,
      sourceLabel: measuredCount > 0 ? "visibility_runs" : "partial probe coverage",
    });

    for (const [idx, vr] of report.visibilityResults.entries()) {
      inventoryVisibilityResult(items, vr, idx);
    }
    inventoryShareOfVoice(items, report);
  }

  if (report.adsEquivalent) {
    const { cpcSource, totalOrganicValue } = report.adsEquivalent;
    pushClaim(items, {
      claimId: "roi.ads_replacement",
      section: "roi",
      claimType: "ads_replacement_value",
      field: "adsEquivalent.totalOrganicValue",
      value: totalOrganicValue,
      classification: cpcSource === "real" ? "measured" : "estimated",
      evidencePointer: cpcSource === "real" ? "attribution_metrics+keyword_cpc_cache" : null,
      sourceLabel:
        cpcSource === "real"
          ? "Google Ads Keyword Planner CPC (real)"
          : "industry-average CPC estimate",
      customerVisibleText:
        cpcSource === "real"
          ? `Replacement value $${totalOrganicValue} at real CPC`
          : `Industry estimate replacement value $${totalOrganicValue}`,
    });
    pushClaim(items, {
      claimId: "roi.cpc_source",
      section: "roi",
      claimType: "cpc_source",
      field: "adsEquivalent.cpcSource",
      value: cpcSource,
      classification: cpcSource === "real" ? "measured" : "estimated",
      evidencePointer: cpcSource === "real" ? "keyword_cpc_cache" : null,
      sourceLabel:
        cpcSource === "real" ? "Google Ads Keyword Planner" : "industry-average CPC estimate",
    });
  } else {
    pushClaim(items, {
      claimId: "roi.ads_replacement",
      section: "roi",
      claimType: "ads_replacement_value",
      field: "adsEquivalent",
      value: null,
      classification: "unavailable",
      sourceLabel: "no attribution or CPC data",
    });
  }

  for (const [idx, f] of report.technicalFindings.entries()) {
    inventoryTechnicalFinding(items, f, idx, "technicalFindings");
  }

  for (const [idx, c] of report.coverageItems.entries()) {
    inventoryCoverageItem(items, c, idx);
  }

  for (const [idx, a] of report.authorityOpportunities.entries()) {
    pushClaim(items, {
      claimId: `authority.opportunity.${a.id}`,
      section: "authority",
      claimType: "authority_opportunity",
      field: `authorityOpportunities[${idx}].target_site`,
      value: a.target_site,
      classification: a.domain_authority != null ? "measured" : "model_knowledge",
      evidencePointer: a.domain_authority != null ? `authority_opportunities:${a.id}` : null,
      sourceLabel: a.domain_authority != null ? "domain authority resolver" : null,
      customerVisibleText: a.pitch_angle ?? a.outreach_email,
    });
  }

  for (const [idx, kw] of (report.strikingKeywords ?? []).entries()) {
    pushClaim(items, {
      claimId: `keyword.striking.${slugPart(kw.keyword)}`,
      section: "keywords",
      claimType: "striking_keyword",
      field: `strikingKeywords[${idx}].position`,
      value: kw.position,
      classification: "measured",
      evidencePointer: `rank_keywords:${kw.keyword}`,
      sourceLabel: "rank tracker",
      customerVisibleText: `${kw.keyword} at position ${kw.position}`,
    });
  }

  for (const [idx, item] of report.roadmapItems.entries()) {
    inventoryRoadmapItem(items, item, idx);
  }

  if (report.proofHtml) {
    pushClaim(items, {
      claimId: "proof.summary",
      section: "proof",
      claimType: "proof_summary",
      field: "proofHtml",
      value: "present",
      classification: "measured",
      evidencePointer: "proof_report",
      sourceLabel: "proof ledger",
    });
  }
}

function inventoryIntelligenceReport(
  report: IntelligenceReport,
  items: ReportClaimInventoryItem[]
): void {
  if (!report.executive || !report.score) return;
  const exec = report.executive;

  pushClaim(items, {
    claimId: "executive.summary",
    section: "executive",
    claimType: "executive_summary",
    field: "executive.omnipresenceScore",
    value: exec.omnipresenceScore,
    classification: exec.available ? mapDataQuality(exec.dataQuality) : "unavailable",
    evidencePointer: exec.available ? `scores:${report.score.id}` : null,
    sourceLabel: exec.available ? "OmniPresence scoring engine" : null,
    customerVisibleText: exec.narrative ?? exec.keyFindings.join("; "),
  });

  const subAvail = exec.subScoresAvailable ?? {};
  for (const [dim, available] of Object.entries(subAvail)) {
    pushClaim(items, {
      claimId: `score.subscore.${dim}`,
      section: "executive",
      claimType: "executive_subscore",
      field: `executive.subScores.${dim}`,
      value: available ? exec.subScores[dim] ?? null : null,
      classification: available ? mapDataQuality(exec.dataQuality) : "unavailable",
      evidencePointer: available ? `scores:${report.score.id}#${dim}` : null,
      sourceLabel: available ? "OmniPresence scoring engine" : "dimension unavailable",
    });
  }

  for (const [idx, finding] of exec.keyFindings.entries()) {
    pushClaim(items, {
      claimId: `executive.key_finding.${idx}`,
      section: "executive",
      claimType: "key_finding",
      field: `executive.keyFindings[${idx}]`,
      value: finding,
      classification: exec.available ? mapDataQuality(exec.dataQuality) : "unavailable",
      evidencePointer: exec.available ? `scores:${report.score.id}` : null,
      sourceLabel: exec.available ? "OmniPresence scoring engine" : null,
      customerVisibleText: finding,
    });
  }

  if (report.competitive.available && report.competitive.target) {
    pushClaim(items, {
      claimId: "competitive.comparison",
      section: "competitive",
      claimType: "competitor_comparison",
      field: "competitive.target.popularity.tier",
      value: report.competitive.target.popularity.tier,
      classification: mapDataQuality(report.competitive.dataQuality),
      evidencePointer: "competitive_snapshot",
      sourceLabel: "competitive snapshot",
    });
  } else {
    pushClaim(items, {
      claimId: "competitive.comparison",
      section: "competitive",
      claimType: "competitor_comparison",
      field: "competitive",
      value: null,
      classification: "unavailable",
    });
  }

  const vis = report.visibility;
  if (vis.available && vis.snapshot.ratesReliable) {
    pushClaim(items, {
      claimId: "visibility.rate",
      section: "visibility",
      claimType: "ai_visibility_rate",
      field: "visibility.snapshot.metrics.mentionRate",
      value: vis.snapshot.metrics.mentionRate,
      classification: "measured",
      evidencePointer: `visibility_runs:grounded=${vis.snapshot.groundedCount}`,
      sourceLabel: "grounded probes",
      customerVisibleText: `Mention rate ${Math.round(vis.snapshot.metrics.mentionRate * 100)}%`,
    });
  } else {
    pushClaim(items, {
      claimId: "visibility.rate",
      section: "visibility",
      claimType: "ai_visibility_rate",
      field: "visibility.snapshot",
      value: null,
      classification: "unavailable",
      sourceLabel: vis.snapshot.reliabilityNote ?? "insufficient probe coverage",
      customerVisibleText: vis.snapshot.reliabilityNote,
    });
  }

  if (report.keywords.available) {
    for (const [idx, kw] of report.keywords.opportunities.slice(0, 20).entries()) {
      pushClaim(items, {
        claimId: `keyword.opportunity.${slugPart(kw.keyword)}`,
        section: "keywords",
        claimType: "keyword_opportunity",
        field: `keywords.opportunities[${idx}].volume`,
        value: kw.volume,
        classification: mapDataQuality(kw.dataQuality),
        evidencePointer: `keywords:${kw.keyword}`,
        sourceLabel: kw.dataQuality,
        customerVisibleText: kw.keyword,
      });
    }
    for (const [idx, kw] of report.keywords.strikingDistance.entries()) {
      pushClaim(items, {
        claimId: `keyword.striking.${slugPart(kw.keyword)}`,
        section: "keywords",
        claimType: "serp_rank",
        field: `keywords.strikingDistance[${idx}].position`,
        value: kw.position,
        classification: mapDataQuality(kw.dataQuality),
        evidencePointer: `keywords:${kw.keyword}`,
        sourceLabel: kw.dataQuality,
      });
    }
  }

  if (report.backlinks.available) {
    pushClaim(items, {
      claimId: "backlinks.referring_domains",
      section: "backlinks",
      claimType: "referring_domains",
      field: "backlinks.referringDomains",
      value: report.backlinks.referringDomains,
      classification: mapDataQuality(report.backlinks.dataQuality),
      evidencePointer: "backlinks_free",
      sourceLabel: report.backlinks.authoritySources.join(", ") || "backlinks index",
    });
  } else {
    pushClaim(items, {
      claimId: "backlinks.referring_domains",
      section: "backlinks",
      claimType: "referring_domains",
      field: "backlinks",
      value: null,
      classification: "unavailable",
    });
  }

  if (report.technical.available) {
    for (const [idx, f] of report.technical.findings.entries()) {
      inventoryTechnicalFinding(items, f, idx, "technical.findings");
    }
    if (report.technical.cwv) {
      pushClaim(items, {
        claimId: "technical.cwv.lcp",
        section: "technical",
        claimType: "cwv_metric",
        field: "technical.cwv.lcp",
        value: report.technical.cwv.lcp,
        classification: mapDataQuality(report.technical.cwv.dataQuality),
        evidencePointer: "cwv_history",
        sourceLabel: report.technical.cwv.dataQuality,
      });
    }
  }

  if (report.local.available) {
    pushClaim(items, {
      claimId: "local.listings",
      section: "local",
      claimType: "local_listings",
      field: "local.listingsFound",
      value: report.local.listingsFound,
      classification: mapDataQuality(report.local.dataQuality),
      evidencePointer: "local_listings",
      sourceLabel: report.local.dataQuality,
    });
  } else {
    pushClaim(items, {
      claimId: "local.listings",
      section: "local",
      claimType: "local_listings",
      field: "local",
      value: null,
      classification: "unavailable",
    });
  }

  const roi = report.roi;
  if (roi.available && roi.adsEquivalent != null) {
    const cpcSource = roi.cpcSource ?? "industry_estimate";
    pushClaim(items, {
      claimId: "roi.ads_replacement",
      section: "roi",
      claimType: "ads_replacement_value",
      field: "roi.adsEquivalent",
      value: roi.adsEquivalent,
      classification: cpcSource === "real" ? "measured" : "estimated",
      evidencePointer: cpcSource === "real" ? "attribution_metrics+keyword_cpc_cache" : null,
      sourceLabel:
        cpcSource === "real" ? "Google Ads Keyword Planner CPC (real)" : "industry-average CPC estimate",
      customerVisibleText:
        cpcSource === "real"
          ? `Replacement value $${roi.adsEquivalent} at real CPC`
          : `Industry estimate replacement value $${roi.adsEquivalent}`,
    });
  } else {
    pushClaim(items, {
      claimId: "roi.ads_replacement",
      section: "roi",
      claimType: "ads_replacement_value",
      field: "roi.adsEquivalent",
      value: null,
      classification: "unavailable",
    });
  }

  for (const [idx, item] of report.roadmap.items.entries()) {
    inventoryRoadmapItem(items, item, idx);
  }

  for (const [idx, item] of report.coverageItems.entries()) {
    inventoryCoverageItem(items, item, idx);
  }

  for (const [idx, a] of report.authorityOpportunities.entries()) {
    pushClaim(items, {
      claimId: `authority.opportunity.${a.id}`,
      section: "authority",
      claimType: "authority_opportunity",
      field: `authorityOpportunities[${idx}]`,
      value: a.target_site,
      classification: a.domain_authority != null ? "measured" : "model_knowledge",
      evidencePointer: a.domain_authority != null ? `authority_opportunities:${a.id}` : null,
      sourceLabel: a.domain_authority != null ? "domain authority" : null,
      customerVisibleText: a.pitch_angle,
    });
  }

  for (const [idx, vr] of report.visibilityResults.entries()) {
    inventoryVisibilityResult(items, vr, idx);
  }

  inventoryShareOfVoice(items, report);
  inventoryIntelligenceSection(items, report);
}

export function inventoryReportClaims(
  report: ReportData | IntelligenceReport,
  options?: ValidateReportClaimsOptions
): ReportClaimInventoryItem[] {
  const items: ReportClaimInventoryItem[] = [];
  if (isIntelligenceReport(report)) {
    inventoryIntelligenceReport(report, items);
  } else if ("score" in report && report.score) {
    inventoryStandardReport(report, items);
  }
  inventoryNarrativeSections(items, options?.narrative);
  return items;
}

function validateInventoryItem(item: ReportClaimInventoryItem): ReportClaimViolation[] {
  const violations: ReportClaimViolation[] = [];
  const base = {
    claimId: item.claimId,
    section: item.section,
    claimType: item.claimType,
    field: item.field,
  };

  if (item.classification === "measured") {
    const hasEvidence =
      isValidEvidencePointer(item.evidencePointer, item.claimType) ||
      Boolean(item.sourceLabel && !MEANINGLESS_SOURCE_LABELS.has(item.sourceLabel.toLowerCase()));
    if (!hasEvidence) {
      violations.push({
        ...base,
        reason: "Measured claim has no evidence pointer or source label.",
        severity: "error",
      });
    }
  }

  if (requiresEstimateLabelRule(item)) {
    if (!hasEstimateLabel(item.customerVisibleText, item.sourceLabel)) {
      violations.push({
        ...base,
        reason: "Estimated claim is not clearly labeled as estimated.",
        severity: "warning",
      });
    }
  }

  if (item.classification === "unavailable" && isZeroLikeValue(item.value)) {
    violations.push({
      ...base,
      reason: "Unavailable data is represented as zero.",
      severity: "error",
    });
  }

  if (item.claimType === "ads_replacement_value" && item.value != null) {
    const source = String(item.sourceLabel ?? "").toLowerCase();
    const isRealCpc = source.includes("keyword planner") || source === "real";
    if (item.classification === "measured" && !isRealCpc) {
      violations.push({
        ...base,
        reason: "Ads-replacement value appears measured but CPC source is not real.",
        severity: "error",
      });
    }
    if (
      !isRealCpc &&
      item.classification === "estimated" &&
      !hasEstimateLabel(item.customerVisibleText, item.sourceLabel)
    ) {
      violations.push({
        ...base,
        reason: "Ads-replacement value uses estimated CPC without estimated label.",
        severity: "warning",
      });
    }
  }

  const visibleText = item.customerVisibleText?.trim();
  if (visibleText) {
    const genericHits = findGenericUnsupportedPhrases(visibleText);
    const forbiddenHits = findForbiddenClaims(visibleText);
    const recommendationTypes = new Set([
      "roadmap_item",
      "key_finding",
      "technical_recommendation",
      "narrative_section",
    ]);

    if (genericHits.length > 0 && recommendationTypes.has(item.claimType)) {
      violations.push({
        ...base,
        reason: "Generic unsupported recommendation phrase.",
        severity: "warning",
      });
    }

    if (
      forbiddenHits.length > 0 &&
      (item.claimType === "executive_summary" ||
        item.claimType === "key_finding" ||
        item.claimType === "narrative_section")
    ) {
      violations.push({
        ...base,
        reason: "Generic unsupported recommendation phrase.",
        severity: "warning",
      });
    }
  }

  return violations;
}

export function validateReportClaims(
  report: ReportData | IntelligenceReport,
  options?: ValidateReportClaimsOptions
): ReportQualityValidationResult {
  const inventory = inventoryReportClaims(report, options);
  return validateClaimInventoryItems(inventory);
}

export function validateClaimInventoryItems(
  inventory: ReportClaimInventoryItem[]
): ReportQualityValidationResult {
  const violations: ReportClaimViolation[] = [];
  for (const item of inventory) {
    violations.push(...validateInventoryItem(item));
  }
  const passed = violations.filter((v) => v.severity === "error").length === 0;
  return { passed, violations, inventory };
}

export function summarizeReportClaimViolations(result: ReportQualityValidationResult): string {
  if (result.violations.length === 0) {
    return "No claim quality violations detected.";
  }
  const errors = result.violations.filter((v) => v.severity === "error").length;
  const warnings = result.violations.filter((v) => v.severity === "warning").length;
  const sections = [...new Set(result.violations.map((v) => v.section))].join(", ");
  return `${result.violations.length} violation(s) (${errors} error, ${warnings} warning) across sections: ${sections}. Inventory size: ${result.inventory.length}.`;
}

export function logReportQualityValidation(
  result: ReportQualityValidationResult,
  context: { reportType: "standard" | "deep"; projectId?: string; reportId?: string }
): void {
  if (result.violations.length === 0) return;
  const preview = result.violations
    .slice(0, 3)
    .map((v) => `${v.claimId}: ${v.reason}`)
    .join("; ");
  console.warn(
    `[report-quality-gate] ${context.reportType} report` +
      (context.reportId ? ` ${context.reportId}` : "") +
      `: ${result.violations.length} violation(s). ${preview}. ${summarizeReportClaimViolations(result)}`
  );
}
