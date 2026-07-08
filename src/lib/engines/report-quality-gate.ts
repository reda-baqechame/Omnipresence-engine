/**
 * Patch F.1a — report-wide claim inventory + validator skeleton (logging only).
 *
 * Inspects customer-facing report payloads before render/persist and flags
 * unsupported claims. Does not block delivery or mutate output in F.1a.
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

export type ClaimClassification =
  | "measured"
  | "estimated"
  | "model_knowledge"
  | "simulated"
  | "unavailable";

export type ReportClaimSeverity = "info" | "warning" | "error";

export interface ReportClaimViolation {
  section: string;
  claimType: string;
  field: string;
  reason: string;
  severity: ReportClaimSeverity;
}

export interface ReportClaimInventoryItem {
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

/** Generic recommendation slop — only flagged in unsupported customer-visible copy. */
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

function pushItem(
  items: ReportClaimInventoryItem[],
  item: ReportClaimInventoryItem
): void {
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

function inventoryStandardReport(report: ReportData, items: ReportClaimInventoryItem[]): void {
  if (!report.score) return;
  const { score } = report;
  const breakdown = score.breakdown as
    | { dimension_availability?: Record<string, boolean> }
    | undefined;
  const dimAvail = breakdown?.dimension_availability ?? {};

  pushItem(items, {
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
    pushItem(items, {
      section: "score",
      claimType: "subscore",
      field: label,
      value: available ? rawValue : rawValue,
      classification: available ? mapDataQuality(score.data_source) : "unavailable",
      evidencePointer: available && score.data_source === "measured" ? `scores:${score.id}#${label}` : null,
      sourceLabel: available
        ? score.data_source === "measured"
          ? "OmniPresence scoring engine"
          : score.data_source ?? null
        : "dimension unavailable",
    });
  }

  if (report.visibilityResults.length === 0) {
    pushItem(items, {
      section: "visibility",
      claimType: "ai_visibility",
      field: "visibilityResults",
      value: null,
      classification: "unavailable",
      sourceLabel: "no visibility probes",
    });
  } else {
    const measuredCount = report.visibilityResults.filter((v) => v.data_source === "measured").length;
    pushItem(items, {
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
  }

  if (report.adsEquivalent) {
    const { cpcSource, totalOrganicValue } = report.adsEquivalent;
    const classification: ClaimClassification =
      cpcSource === "real" ? "measured" : "estimated";
    pushItem(items, {
      section: "roi",
      claimType: "ads_replacement_value",
      field: "adsEquivalent.totalOrganicValue",
      value: totalOrganicValue,
      classification,
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
    pushItem(items, {
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
    pushItem(items, {
      section: "roi",
      claimType: "ads_replacement_value",
      field: "adsEquivalent",
      value: null,
      classification: "unavailable",
      sourceLabel: "no attribution or CPC data",
    });
  }

  for (const [idx, f] of report.technicalFindings.entries()) {
    pushItem(items, {
      section: "technical",
      claimType: "technical_finding",
      field: `technicalFindings[${idx}].title`,
      value: f.title,
      classification: mapDataQuality(f.data_source),
      evidencePointer: `technical_findings:${f.id}`,
      sourceLabel: f.provider ?? (f.data_source !== "measured" ? f.data_source : null) ?? null,
      customerVisibleText: f.fix_recommendation ?? f.description,
    });
  }

  for (const [idx, c] of report.coverageItems.entries()) {
    inventoryCoverageItem(items, c, idx);
  }

  for (const [idx, a] of report.authorityOpportunities.entries()) {
    pushItem(items, {
      section: "authority",
      claimType: "authority_opportunity",
      field: `authorityOpportunities[${idx}].target_site`,
      value: a.target_site,
      classification: a.domain_authority != null ? "measured" : "estimated",
      evidencePointer: a.domain_authority != null ? `authority_opportunities:${a.id}` : null,
      sourceLabel: a.domain_authority != null ? "domain authority resolver" : null,
      customerVisibleText: a.pitch_angle ?? a.outreach_email,
    });
  }

  for (const [idx, kw] of (report.strikingKeywords ?? []).entries()) {
    pushItem(items, {
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
    pushItem(items, {
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

function inventoryVisibilityResult(
  items: ReportClaimInventoryItem[],
  vr: VisibilityResult,
  idx: number
): void {
  pushItem(items, {
    section: "visibility",
    claimType: "visibility_probe",
    field: `visibilityResults[${idx}].mention_rate`,
    value: vr.brand_mentioned,
    classification: mapDataQuality(vr.data_source),
    evidencePointer: `visibility_results:${vr.id}`,
    sourceLabel: vr.engine,
  });
}

function inventoryCoverageItem(items: ReportClaimInventoryItem[], c: CoverageItem, idx: number): void {
  const dq = c.data_quality ?? c.data_source;
  pushItem(items, {
    section: "coverage",
    claimType: "coverage_gap",
    field: `coverageItems[${idx}].platform_name`,
    value: c.platform_name,
    classification: c.is_present ? mapDataQuality(dq) : "unavailable",
    evidencePointer: c.measured ? `coverage_items:${c.id}` : null,
    sourceLabel: dq ?? (c.measured ? "measured" : null),
    customerVisibleText: c.notes,
  });
}

function inventoryRoadmapItem(items: ReportClaimInventoryItem[], item: RoadmapItem, idx: number): void {
  const hasEvidence = Boolean(item.evidence_label || item.evidence_url || item.source_type);
  pushItem(items, {
    section: "roadmap",
    claimType: "roadmap_item",
    field: `roadmapItems[${idx}].title`,
    value: item.title,
    classification: hasEvidence ? "measured" : "estimated",
    evidencePointer: item.evidence_url ?? (item.source_type ? `roadmap:${item.source_type}` : null),
    sourceLabel: item.evidence_label ?? item.source_type ?? null,
    customerVisibleText: `${item.title}: ${item.description}`,
  });
}

function inventoryIntelligenceReport(report: IntelligenceReport, items: ReportClaimInventoryItem[]): void {
  if (!report.executive || !report.score) return;
  const exec = report.executive;
  pushItem(items, {
    section: "executive",
    claimType: "executive_summary",
    field: "executive.omnipresenceScore",
    value: exec.omnipresenceScore,
    classification: exec.available ? mapDataQuality(exec.dataQuality) : "unavailable",
    evidencePointer: exec.available ? `scores:${report.score.id}` : null,
    sourceLabel: exec.dataQuality,
    customerVisibleText: exec.narrative ?? exec.keyFindings.join("; "),
  });

  for (const [idx, finding] of exec.keyFindings.entries()) {
    pushItem(items, {
      section: "executive",
      claimType: "key_finding",
      field: `executive.keyFindings[${idx}]`,
      value: finding,
      classification: exec.available ? mapDataQuality(exec.dataQuality) : "unavailable",
      evidencePointer: exec.available ? `executive.keyFindings[${idx}]` : null,
      sourceLabel: exec.dataQuality,
      customerVisibleText: finding,
    });
  }

  if (report.competitive.available && report.competitive.target) {
    pushItem(items, {
      section: "competitive",
      claimType: "competitor_comparison",
      field: "competitive.target.popularity.tier",
      value: report.competitive.target.popularity.tier,
      classification: mapDataQuality(report.competitive.dataQuality),
      evidencePointer: "competitive_snapshot",
      sourceLabel: report.competitive.dataQuality,
    });
  } else {
    pushItem(items, {
      section: "competitive",
      claimType: "competitor_comparison",
      field: "competitive",
      value: null,
      classification: "unavailable",
    });
  }

  const vis = report.visibility;
  if (vis.available && vis.snapshot.ratesReliable) {
    pushItem(items, {
      section: "visibility",
      claimType: "ai_visibility_rate",
      field: "visibility.snapshot.metrics.mentionRate",
      value: vis.snapshot.metrics.mentionRate,
      classification: "measured",
      evidencePointer: `visibility_runs:grounded=${vis.snapshot.groundedCount}`,
      sourceLabel: "grounded probes",
    });
  } else {
    pushItem(items, {
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
      pushItem(items, {
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
      pushItem(items, {
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
    pushItem(items, {
      section: "backlinks",
      claimType: "referring_domains",
      field: "backlinks.referringDomains",
      value: report.backlinks.referringDomains,
      classification: mapDataQuality(report.backlinks.dataQuality),
      evidencePointer: "backlinks_free",
      sourceLabel: report.backlinks.authoritySources.join(", ") || report.backlinks.dataQuality,
    });
  } else {
    pushItem(items, {
      section: "backlinks",
      claimType: "referring_domains",
      field: "backlinks",
      value: null,
      classification: "unavailable",
    });
  }

  if (report.technical.available) {
    for (const [idx, f] of report.technical.findings.entries()) {
      pushItem(items, {
        section: "technical",
        claimType: "technical_finding",
        field: `technical.findings[${idx}].title`,
        value: f.title,
        classification: mapDataQuality(f.data_source),
        evidencePointer: `technical_findings:${f.id}`,
        sourceLabel: f.provider ?? f.data_source ?? null,
        customerVisibleText: f.fix_recommendation ?? f.description,
      });
    }
    if (report.technical.cwv) {
      pushItem(items, {
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
    pushItem(items, {
      section: "local",
      claimType: "local_listings",
      field: "local.listingsFound",
      value: report.local.listingsFound,
      classification: mapDataQuality(report.local.dataQuality),
      evidencePointer: "local_listings",
      sourceLabel: report.local.dataQuality,
    });
  } else {
    pushItem(items, {
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
    pushItem(items, {
      section: "roi",
      claimType: "ads_replacement_value",
      field: "roi.adsEquivalent",
      value: roi.adsEquivalent,
      classification: cpcSource === "real" ? "measured" : "estimated",
      evidencePointer: cpcSource === "real" ? "attribution_metrics+keyword_cpc_cache" : null,
      sourceLabel: cpcSource,
      customerVisibleText:
        cpcSource === "real"
          ? `Replacement value $${roi.adsEquivalent} at real CPC`
          : `Industry estimate replacement value $${roi.adsEquivalent}`,
    });
  } else {
    pushItem(items, {
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
    pushItem(items, {
      section: "authority",
      claimType: "authority_opportunity",
      field: `authorityOpportunities[${idx}]`,
      value: a.target_site,
      classification: a.domain_authority != null ? "measured" : "estimated",
      evidencePointer: `authority_opportunities:${a.id}`,
      sourceLabel: a.domain_authority != null ? "domain authority" : null,
      customerVisibleText: a.pitch_angle,
    });
  }

  for (const [idx, vr] of report.visibilityResults.entries()) {
    inventoryVisibilityResult(items, vr, idx);
  }
}

export function inventoryReportClaims(
  report: ReportData | IntelligenceReport
): ReportClaimInventoryItem[] {
  const items: ReportClaimInventoryItem[] = [];
  if (isIntelligenceReport(report)) {
    inventoryIntelligenceReport(report, items);
  } else if ("score" in report && report.score) {
    inventoryStandardReport(report, items);
  }
  return items;
}

function validateInventoryItem(item: ReportClaimInventoryItem): ReportClaimViolation[] {
  const violations: ReportClaimViolation[] = [];

  // Rule 1 — measured requires evidence
  if (item.classification === "measured") {
    const meaninglessLabels = new Set([
      "measured",
      "estimated",
      "unavailable",
      "null",
      "industry_estimate",
      "real",
      "estimated_proxy",
      "not_available",
    ]);
    const hasEvidence =
      Boolean(item.evidencePointer) ||
      Boolean(item.sourceLabel && !meaninglessLabels.has(item.sourceLabel.toLowerCase()));
    if (!hasEvidence) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Measured claim has no evidence pointer or source label.",
        severity: "error",
      });
    }
  }

  // Rule 2 — estimated must be labeled
  if (item.classification === "estimated" && item.claimType !== "cpc_source") {
    if (!hasEstimateLabel(item.customerVisibleText, item.sourceLabel)) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Estimated claim is not clearly labeled as estimated.",
        severity: "warning",
      });
    }
  }

  // Rule 3 — unavailable must not be zero
  if (item.classification === "unavailable" && isZeroLikeValue(item.value)) {
    violations.push({
      section: item.section,
      claimType: item.claimType,
      field: item.field,
      reason: "Unavailable data is represented as zero.",
      severity: "error",
    });
  }

  // Rule 4 — ads-replacement CPC provenance
  if (item.claimType === "ads_replacement_value" && item.value != null) {
    const source = String(item.sourceLabel ?? "").toLowerCase();
    const isRealCpc = source === "real" || source.includes("keyword planner");
    if (item.classification === "measured" && !isRealCpc) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Ads-replacement value appears measured but CPC source is not real.",
        severity: "error",
      });
    }
    if (!isRealCpc && item.classification !== "unavailable" && !hasEstimateLabel(item.customerVisibleText, item.sourceLabel)) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Ads-replacement value uses estimated CPC without estimated label.",
        severity: "warning",
      });
    }
    if (item.classification === "unavailable" && isZeroLikeValue(item.value)) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Unavailable data is represented as zero.",
        severity: "error",
      });
    }
  }

  // Rule 5 — generic unsupported phrasing in customer-visible copy
  const visibleText = item.customerVisibleText?.trim();
  if (visibleText) {
    const genericHits = findGenericUnsupportedPhrases(visibleText);
    const forbiddenHits = findForbiddenClaims(visibleText);
    const unsupportedRecommendation =
      (item.claimType === "roadmap_item" ||
        item.claimType === "key_finding" ||
        item.claimType === "technical_finding") &&
      !item.evidencePointer &&
      !item.sourceLabel;

    if (genericHits.length > 0 && unsupportedRecommendation) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Generic unsupported recommendation phrase.",
        severity: "warning",
      });
    }

    if (forbiddenHits.length > 0 && (item.claimType === "executive_summary" || item.claimType === "key_finding")) {
      violations.push({
        section: item.section,
        claimType: item.claimType,
        field: item.field,
        reason: "Generic unsupported recommendation phrase.",
        severity: "warning",
      });
    }
  }

  return violations;
}

export function validateReportClaims(
  report: ReportData | IntelligenceReport
): ReportQualityValidationResult {
  const inventory = inventoryReportClaims(report);
  return validateClaimInventoryItems(inventory);
}

/** Validate a pre-built inventory (used by tests and future sanitize pass). */
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

/** Logging-only hook for F.1a — does not block or mutate reports. */
export function logReportQualityValidation(
  result: ReportQualityValidationResult,
  context: { reportType: "standard" | "deep"; projectId?: string; reportId?: string }
): void {
  if (result.violations.length === 0) return;
  const preview = result.violations
    .slice(0, 3)
    .map((v) => `${v.section}/${v.claimType}: ${v.reason}`)
    .join("; ");
  console.warn(
    `[report-quality-gate] ${context.reportType} report` +
      (context.reportId ? ` ${context.reportId}` : "") +
      `: ${result.violations.length} violation(s). ${preview}. ${summarizeReportClaimViolations(result)}`
  );
}
