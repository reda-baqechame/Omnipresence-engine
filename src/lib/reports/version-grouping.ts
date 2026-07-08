export interface VersionedReport {
  id: string;
  previous_report_id?: string | null;
}

/**
 * Basic versioning (P1 fix): regenerating a report links the new row to the
 * one it replaces via `previous_report_id` (migration 0081), scoped per
 * project+report_type. Groups a flat `reports` result into
 * `{ latest, ancestors[] }` per lineage — the Reports list shows one card per
 * lineage with its version history collapsed underneath, instead of an
 * ever-growing pile of same-titled entries.
 *
 * Pure and framework-free so it can be unit tested without a database —
 * extracted out of the reports page server component for that reason.
 */
export function groupReportVersions<T extends VersionedReport>(
  reports: T[]
): Array<{ latest: T; ancestors: T[] }> {
  const byId = new Map(reports.map((r) => [r.id, r]));
  const supersededIds = new Set(
    reports.map((r) => r.previous_report_id).filter((id): id is string => Boolean(id))
  );

  return reports
    .filter((r) => !supersededIds.has(r.id))
    .map((latest) => {
      const ancestors: T[] = [];
      let cursor = latest.previous_report_id;
      const seen = new Set<string>([latest.id]);
      while (cursor && !seen.has(cursor)) {
        const prev = byId.get(cursor) as T | undefined;
        if (!prev) break;
        ancestors.push(prev);
        seen.add(prev.id);
        cursor = prev.previous_report_id;
      }
      return { latest, ancestors };
    });
}
