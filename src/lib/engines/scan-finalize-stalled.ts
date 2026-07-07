import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project } from "@/types/database";
import { finalizeVisibilityScan } from "@/lib/engines/visibility-scan-batches";
import { stepScoreAndRoadmap } from "@/lib/engines/scan-steps";
import type { VisibilityScanResult } from "@/lib/engines/visibility-scanner";

/**
 * Complete a scan that has visibility data but never reached finalize (Inngest
 * step hung on evidence/source-graph). Uses partial results honestly.
 */
export async function finalizeStalledScan(
  supabase: SupabaseClient,
  projectId: string,
  runId: string
): Promise<{ score: number } | null> {
  const { data: project } = await supabase.from("projects").select("*").eq("id", projectId).single();
  if (!project) return null;

  const { data: rows } = await supabase
    .from("visibility_results")
    .select("*")
    .eq("run_id", runId)
    .eq("project_id", projectId);
  if (!rows?.length) return null;

  const { data: findings } = await supabase
    .from("technical_findings")
    .select("*")
    .eq("project_id", projectId);

  await finalizeVisibilityScan(
    supabase,
    project as Project,
    runId,
    rows as unknown as VisibilityScanResult[],
    { scanPartial: true }
  );

  const { score } = await stepScoreAndRoadmap(
    supabase,
    project as Project,
    (findings || []) as Awaited<ReturnType<typeof import("@/lib/engines/scan-steps").stepTechnicalAudit>>
  );

  await supabase
    .from("projects")
    .update({
      status: "active",
      last_scan_at: new Date().toISOString(),
    })
    .eq("id", projectId);

  return { score: score.omnipresence_score };
}
