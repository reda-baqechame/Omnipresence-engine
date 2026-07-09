/**
 * Patch F.1c/F.1d — feature flags for report quality enforcement.
 * Both default OFF; no customer-facing behavior change unless explicitly enabled.
 */

export function isReportQualitySanitizeEnabled(): boolean {
  return process.env.REPORT_QUALITY_SANITIZE === "1";
}

export function isReportQualityBlockCriticalEnabled(): boolean {
  return process.env.REPORT_QUALITY_BLOCK_CRITICAL === "1";
}

export const REPORT_QUALITY_BLOCK_MESSAGE =
  "Report quality gate blocked this report because unsupported measured claims were detected.";
