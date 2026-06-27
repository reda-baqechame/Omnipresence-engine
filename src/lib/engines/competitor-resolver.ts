import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveCompetitorList,
  type ResolvedCompetitor,
} from "@/lib/providers/competitor-resolve";

/**
 * Persist SERP-resolved competitor domains (with confidence + evidence) to the
 * `competitors` table. Unresolved competitors are still stored (domain null,
 * source "unresolved") so the UI can flag them for manual confirmation instead
 * of the platform silently guessing a wrong domain.
 */
export async function persistResolvedCompetitors(
  supabase: SupabaseClient,
  projectId: string,
  resolved: ResolvedCompetitor[]
): Promise<void> {
  if (!resolved.length) return;
  const now = new Date().toISOString();
  await supabase.from("competitors").upsert(
    resolved.map((r) => ({
      project_id: projectId,
      name: r.name,
      domain: r.domain,
      source: r.source,
      confidence: r.confidence,
      confirmed: false,
      evidence_url: r.evidence_url,
      updated_at: now,
    })),
    { onConflict: "project_id,name" }
  );
}

/** Resolve a project's competitor names to domains and persist them in one step. */
export async function resolveAndPersistCompetitors(
  supabase: SupabaseClient,
  projectId: string,
  competitors: string[],
  industry: string
): Promise<ResolvedCompetitor[]> {
  if (!competitors.length) return [];
  const resolved = await resolveCompetitorList(competitors, industry).catch(() => []);
  await persistResolvedCompetitors(supabase, projectId, resolved).catch(() => {});
  return resolved;
}
