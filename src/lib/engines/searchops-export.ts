/**
 * Flatten SearchOps opportunities for CSV/JSON export (evidence + verification plan).
 */
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import { toCsv } from "@/lib/export/datasets";

export const SEARCHOPS_EXPORT_COLUMNS = [
  "id",
  "category",
  "priority",
  "impact_type",
  "effort",
  "title",
  "diagnosis",
  "recommended_action",
  "verification_plan",
  "limitations",
  "evidence_labels",
  "evidence_sources",
  "evidence_statuses",
  "primary_evidence_json",
] as const;

export type SearchOpsExportRow = Record<(typeof SEARCHOPS_EXPORT_COLUMNS)[number], string>;

export function opportunitiesToExportRows(ops: SearchOpsOpportunity[]): SearchOpsExportRow[] {
  return ops.map((op) => {
    const primary = op.evidence[0]?.value;
    return {
      id: op.id,
      category: op.category,
      priority: op.priority,
      impact_type: op.impactType,
      effort: op.effort,
      title: op.title,
      diagnosis: op.diagnosis,
      recommended_action: op.recommendedAction,
      verification_plan: op.verificationPlan,
      limitations: (op.limitations || []).join(" | "),
      evidence_labels: op.evidence.map((e) => e.label).join(" | "),
      evidence_sources: op.evidence.map((e) => e.source).join(" | "),
      evidence_statuses: op.evidence.map((e) => e.status).join(" | "),
      primary_evidence_json:
        primary === undefined || primary === null
          ? ""
          : typeof primary === "string"
            ? primary
            : JSON.stringify(primary),
    };
  });
}

export function opportunitiesToCsv(ops: SearchOpsOpportunity[]): string {
  const rows = opportunitiesToExportRows(ops);
  return toCsv(rows, [...SEARCHOPS_EXPORT_COLUMNS]);
}
