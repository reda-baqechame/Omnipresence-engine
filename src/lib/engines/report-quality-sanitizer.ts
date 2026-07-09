/**
 * Patch F.1c — non-destructive report claim sanitization (feature-flagged).
 * Never invents data; converts unsafe customer-facing claims into safer language.
 */
import type { ReportData } from "@/lib/engines/report-generator";
import type { IntelligenceReport } from "@/types/intelligence-report";
import type { ReportNarrative } from "@/lib/engines/intelligence-report-narrative";
import type {
  ReportQualityValidationResult,
  ReportClaimViolation,
  ReportClaimInventoryItem,
} from "@/lib/engines/report-quality-gate";

export type SanitizeReportMode = "observe" | "sanitize";
export type SanitizeReportType = "standard" | "deep_intelligence" | "html_view";

export interface SanitizeReportClaimsOptions {
  mode: SanitizeReportMode;
  reportType: SanitizeReportType;
}

export interface SanitizeReportClaimsResult {
  report: ReportData | IntelligenceReport;
  narrative?: ReportNarrative;
  sanitizedCount: number;
  changedClaimIds: string[];
}

const SAFE_GENERIC_RECOMMENDATION =
  "Review this recommendation against the available evidence before prioritizing.";

function cloneReport<T>(report: T): T {
  return structuredClone(report);
}

function inventoryByClaimId(
  inventory: ReportClaimInventoryItem[]
): Map<string, ReportClaimInventoryItem> {
  return new Map(inventory.map((item) => [item.claimId, item]));
}

function formatEstimatedAdsValue(value: number): string {
  return `Estimated ads-replacement value: approximately $${value.toLocaleString()}, based on industry-estimate CPC.`;
}

function formatUnavailableAdsValue(): string {
  return "Ads-replacement value unavailable because CPC evidence is unavailable.";
}

function formatUnavailableBacklinks(): string {
  return "Backlink coverage was not measured in this report.";
}

function formatUnavailableAiVisibility(): string {
  return "AI visibility was not measured for this report.";
}

function shouldSanitizeViolation(v: ReportClaimViolation): boolean {
  if (v.reason.includes("Generic unsupported recommendation")) return true;
  if (v.reason.includes("estimated CPC without estimated label")) return true;
  if (v.reason.includes("Unsupported guaranteed ranking")) return true;
  if (v.reason.includes("represented as zero")) return true;
  return false;
}

function applySanitizationForClaim(
  report: ReportData | IntelligenceReport,
  narrative: ReportNarrative | undefined,
  item: ReportClaimInventoryItem,
  violation: ReportClaimViolation
): boolean {
  const claimId = item.claimId;

  if (violation.reason.includes("Generic unsupported recommendation") ||
      violation.reason.includes("Unsupported guaranteed ranking")) {
    if (claimId.startsWith("roadmap.item.")) {
      const idx = Number(claimId.split(".").pop());
      if (!Number.isNaN(idx)) {
        if ("roadmapItems" in report && report.roadmapItems?.[idx]) {
          report.roadmapItems[idx].description = SAFE_GENERIC_RECOMMENDATION;
          return true;
        }
        if ("roadmap" in report && report.roadmap?.items?.[idx]) {
          report.roadmap.items[idx].description = SAFE_GENERIC_RECOMMENDATION;
          return true;
        }
      }
    }

    if (claimId.startsWith("technical.recommendation.") || claimId.includes(".recommendation.")) {
      const findingId = claimId.split(".").pop();
      if ("technicalFindings" in report) {
        const finding = report.technicalFindings.find((f) => f.id === findingId);
        if (finding) {
          finding.fix_recommendation = SAFE_GENERIC_RECOMMENDATION;
          return true;
        }
      }
      if ("technical" in report && report.technical?.findings) {
        const finding = report.technical.findings.find((f) => f.id === findingId);
        if (finding) {
          finding.fix_recommendation = SAFE_GENERIC_RECOMMENDATION;
          return true;
        }
      }
    }

    if (claimId.startsWith("executive.key_finding.")) {
      const idx = Number(claimId.split(".").pop());
      if ("executive" in report && report.executive?.keyFindings?.[idx] != null) {
        report.executive.keyFindings[idx] = SAFE_GENERIC_RECOMMENDATION;
        return true;
      }
    }

    if (claimId.startsWith("narrative.") && narrative) {
      const section = claimId.replace("narrative.", "") as keyof ReportNarrative;
      if (section in narrative && narrative[section]) {
        narrative[section] = SAFE_GENERIC_RECOMMENDATION;
        return true;
      }
    }
  }

  if (violation.reason.includes("estimated CPC without estimated label") && item.claimType === "ads_replacement_value") {
    const value = typeof item.value === "number" ? item.value : null;
    if (value != null && "adsEquivalent" in report && report.adsEquivalent) {
      // Preserve numeric data; ensure CPC source stays estimated (no fake measured label).
      report.adsEquivalent.cpcSource = "industry_estimate";
      return true;
    }
    if (value != null && "roi" in report && report.roi?.adsEquivalent != null) {
      report.roi.cpcSource = "industry_estimate";
      return true;
    }
  }

  if (violation.reason.includes("represented as zero") && item.classification === "unavailable") {
    if (claimId.startsWith("score.subscore.")) {
      const dim = claimId.replace("score.subscore.", "");
      if ("score" in report && report.score) {
        const breakdown = (report.score.breakdown ?? {}) as { dimension_availability?: Record<string, boolean> };
        breakdown.dimension_availability = breakdown.dimension_availability ?? {};
        breakdown.dimension_availability[dim] = false;
        report.score.breakdown = breakdown;
        const key = dim as keyof typeof report.score;
        if (key in report.score && typeof report.score[key] === "number") {
          (report.score as unknown as Record<string, unknown>)[key] = null;
        }
        return true;
      }
      if ("executive" in report && report.executive?.subScoresAvailable) {
        report.executive.subScoresAvailable[dim] = false;
        if (report.executive.subScores) {
          delete report.executive.subScores[dim];
        }
        return true;
      }
    }

    if (claimId === "visibility.rate" || claimId === "visibility.aggregate") {
      if ("visibility" in report && report.visibility) {
        report.visibility.available = false;
        report.visibility.snapshot.ratesReliable = false;
        report.visibility.snapshot.reliabilityNote = formatUnavailableAiVisibility();
        return true;
      }
    }

    if (claimId === "backlinks.referring_domains" && "backlinks" in report) {
      report.backlinks.available = false;
      report.backlinks.referringDomains = 0;
      return true;
    }
  }

  if (item.claimType === "ads_replacement_value" && item.classification === "unavailable") {
    if ("adsEquivalent" in report) {
      report.adsEquivalent = undefined;
      return true;
    }
    if ("roi" in report) {
      report.roi.available = false;
      report.roi.adsEquivalent = undefined;
      return true;
    }
  }

  if (item.claimType === "referring_domains" && item.classification === "unavailable" && "backlinks" in report) {
    report.backlinks.available = false;
    return true;
  }

  return false;
}

/**
 * Converts unsupported customer-facing claims into safer language when mode is "sanitize".
 * In "observe" mode the report (and narrative) are returned unchanged.
 */
export function sanitizeReportClaims(
  report: ReportData | IntelligenceReport,
  validationResult: ReportQualityValidationResult,
  options: SanitizeReportClaimsOptions,
  narrative?: ReportNarrative
): SanitizeReportClaimsResult {
  if (options.mode === "observe") {
    return { report, narrative, sanitizedCount: 0, changedClaimIds: [] };
  }

  const cloned = cloneReport(report);
  const clonedNarrative = narrative ? cloneReport(narrative) : undefined;
  const byClaimId = inventoryByClaimId(validationResult.inventory);
  const changedClaimIds: string[] = [];

  for (const violation of validationResult.violations) {
    if (!shouldSanitizeViolation(violation)) continue;
    const item = byClaimId.get(violation.claimId);
    if (!item) continue;
    if (applySanitizationForClaim(cloned, clonedNarrative, item, violation)) {
      changedClaimIds.push(violation.claimId);
    }
  }

  // Proactive safe labels for estimated/unavailable ROI when inventory indicates them.
  for (const item of validationResult.inventory) {
    if (item.claimType === "ads_replacement_value" && item.classification === "estimated") {
      const value = typeof item.value === "number" ? item.value : null;
      if (value != null && "adsEquivalent" in cloned && cloned.adsEquivalent) {
        cloned.adsEquivalent.cpcSource = "industry_estimate";
        if (!changedClaimIds.includes(item.claimId)) changedClaimIds.push(item.claimId);
      }
    }
    if (item.claimType === "ads_replacement_value" && item.classification === "unavailable") {
      if ("adsEquivalent" in cloned) {
        cloned.adsEquivalent = undefined;
        if (!changedClaimIds.includes(item.claimId)) changedClaimIds.push(item.claimId);
      }
    }
    if (item.claimType === "referring_domains" && item.classification === "unavailable" && "backlinks" in cloned) {
      if (cloned.backlinks.available) {
        cloned.backlinks.available = false;
        if (!changedClaimIds.includes(item.claimId)) changedClaimIds.push(item.claimId);
      }
    }
    if (item.claimType === "ai_visibility_rate" && item.classification === "unavailable" && "visibility" in cloned) {
      if (cloned.visibility.snapshot.reliabilityNote !== formatUnavailableAiVisibility()) {
        cloned.visibility.snapshot.reliabilityNote = formatUnavailableAiVisibility();
        if (!changedClaimIds.includes(item.claimId)) changedClaimIds.push(item.claimId);
      }
    }
  }

  return {
    report: cloned,
    narrative: clonedNarrative,
    sanitizedCount: changedClaimIds.length,
    changedClaimIds,
  };
}

export {
  SAFE_GENERIC_RECOMMENDATION,
  formatEstimatedAdsValue,
  formatUnavailableAdsValue,
  formatUnavailableBacklinks,
  formatUnavailableAiVisibility,
};
