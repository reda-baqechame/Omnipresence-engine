/**
 * Prune old report artifacts beyond the last N per project to bound storage cost.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_KEEP = Number(process.env.REPORT_RETENTION_PER_PROJECT || 10);

export async function pruneOldReportArtifacts(
  supabase: SupabaseClient,
  keepPerProject = DEFAULT_KEEP
): Promise<{ deleted: number; projects: number }> {
  const { data: projects } = await supabase.from("projects").select("id");
  if (!projects?.length) return { deleted: 0, projects: 0 };

  let deleted = 0;

  for (const project of projects) {
    const { data: reports } = await supabase
      .from("reports")
      .select("id, pdf_url, html_url")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false });

    if (!reports || reports.length <= keepPerProject) continue;

    const toDelete = reports.slice(keepPerProject);
    for (const report of toDelete) {
      const prefix = `reports/${project.id}/${report.id}`;
      await supabase.storage.from("reports").remove([`${prefix}.html`, `${prefix}.pdf`]);
      await supabase.from("reports").delete().eq("id", report.id);
      deleted += 1;
    }
  }

  return { deleted, projects: projects.length };
}
