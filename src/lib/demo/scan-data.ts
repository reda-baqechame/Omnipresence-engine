import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Demo mode is permanently disabled for product scans.
 *
 * This module is kept only as a compatibility shim for older imports/tests. Real
 * customer projects must never receive fabricated prompts, fake brand claims, or
 * randomized visibility rows. If live providers are unavailable, scanners write
 * honest `unavailable` rows or empty states instead.
 */
export function isDemoMode(): boolean {
  return false;
}

export async function resolveScanDemoMode(
  _supabase: SupabaseClient,
  _organizationId?: string | null
): Promise<boolean> {
  return false;
}

export function generateDemoPrompts(
  _projectId: string,
  _brandName: string,
  _industry: string,
  _location: string,
  _competitors: string[]
) {
  return [];
}

export function generateDemoVisibilityResults(
  _projectId: string,
  _runId: string,
  _brandName: string,
  _brandDomain: string,
  _competitors: string[],
  _prompts: Array<{ text: string }>
) {
  return [];
}

export function generateDemoBrandProfile(_projectName: string, _industry: string) {
  return null;
}

export function generateDemoAuthorityOpportunities(
  _projectId: string,
  _industry: string,
  _competitors: string[]
) {
  return [];
}
