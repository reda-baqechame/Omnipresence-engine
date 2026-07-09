/**
 * Patch F.1b — persist report quality gate violations (non-blocking).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ReportQualityValidationResult,
  ClaimClassification,
} from "@/lib/engines/report-quality-gate";

export interface PersistReportQualityViolationsParams {
  supabase: SupabaseClient;
  result: ReportQualityValidationResult;
  reportType: "standard" | "deep_intelligence";
  projectId?: string | null;
  orgId?: string | null;
  reportId?: string | null;
  renderPath?: string | null;
  sanitizedCount?: number;
}

/**
 * Inserts structured violation rows. Never throws — logs and returns on DB error.
 */
export async function persistReportQualityViolations(
  params: PersistReportQualityViolationsParams
): Promise<void> {
  const { supabase, result, reportType, projectId, orgId, reportId, renderPath, sanitizedCount } =
    params;
  if (result.violations.length === 0 && (sanitizedCount ?? 0) === 0) return;

  const inventoryByKey = new Map(
    result.inventory.map((item) => [`${item.section}::${item.claimType}::${item.field}`, item])
  );

  const rows = result.violations.map((v) => {
    const item = inventoryByKey.get(`${v.section}::${v.claimType}::${v.field}`);
    return {
      report_id: reportId ?? null,
      project_id: projectId ?? null,
      org_id: orgId ?? null,
      report_type: reportType,
      claim_id: v.claimId,
      section: v.section,
      claim_type: v.claimType,
      field: v.field,
      reason: v.reason,
      severity: v.severity,
      source_label: item?.sourceLabel ?? null,
      classification: (item?.classification ?? null) as ClaimClassification | null,
      render_path: renderPath ?? null,
      metadata: sanitizedCount != null && sanitizedCount > 0 ? { sanitized_count: sanitizedCount } : {},
    };
  });

  try {
    const { error } = await supabase.from("report_quality_violations").insert(rows);
    if (error) {
      console.warn(`[report-quality-gate] persist failed: ${error.message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[report-quality-gate] persist failed: ${message}`);
  }
}
