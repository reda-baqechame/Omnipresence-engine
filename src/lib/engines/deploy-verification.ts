/**
 * Post-deploy verification crawler (Wave Q2).
 *
 * After an asset is published, we don't trust the publish response alone — we
 * fetch the live URL and confirm: HTTP 200, expected content present, and (when
 * required) JSON-LD structured data live on the page. Only then do we stamp the
 * results-ledger entry `verified_at` + an after-snapshot. This is what backs the
 * "schema we verify is live" (schema_live) claim honestly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/providers/http";
import { logProviderError } from "@/lib/observability/log";

export interface UrlVerification {
  ok: boolean;
  status: number;
  contentFound: boolean;
  schemaFound: boolean;
  schemaTypes: string[];
  checkedAt: string;
  error?: string;
}

/** Extract the @type values from every JSON-LD block on a page. */
function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const json = JSON.parse(m[1].trim());
      const nodes = Array.isArray(json) ? json : json["@graph"] && Array.isArray(json["@graph"]) ? json["@graph"] : [json];
      for (const node of nodes) {
        const t = node?.["@type"];
        if (typeof t === "string") types.add(t);
        else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
      }
    } catch {
      // malformed JSON-LD — ignore; schemaFound stays based on what parsed
    }
  }
  return [...types];
}

/**
 * Fetch a URL and verify it is live with expected content / schema. Network
 * failures resolve to ok:false (never throw) so the verification sweep is safe.
 */
export async function verifyUrlLive(
  url: string,
  opts: { expectContent?: string[]; expectSchema?: boolean; expectSchemaType?: string } = {}
): Promise<UrlVerification> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(url, { method: "GET", headers: { "User-Agent": "PresenceOS-Verifier/1.0" }, timeoutMs: 15000 });
    const status = res.status;
    if (!res.ok) {
      return { ok: false, status, contentFound: false, schemaFound: false, schemaTypes: [], checkedAt, error: `HTTP ${status}` };
    }
    const html = await res.text();
    const lower = html.toLowerCase();
    const contentFound = !opts.expectContent?.length
      ? true
      : opts.expectContent.every((c) => lower.includes(c.toLowerCase()));
    const schemaTypes = extractSchemaTypes(html);
    const schemaFound = opts.expectSchemaType
      ? schemaTypes.includes(opts.expectSchemaType)
      : schemaTypes.length > 0;

    const ok = status === 200 && contentFound && (!opts.expectSchema || schemaFound);
    return { ok, status, contentFound, schemaFound, schemaTypes, checkedAt };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentFound: false,
      schemaFound: false,
      schemaTypes: [],
      checkedAt,
      error: error instanceof Error ? error.message : "fetch failed",
    };
  }
}

interface LedgerRow {
  id: string;
  project_id: string;
  action_type: string;
  outcome_snapshot: Record<string, unknown> | null;
  delta_summary: Record<string, unknown> | null;
}

function publishedUrlOf(row: LedgerRow): string | null {
  const snap = row.outcome_snapshot || {};
  const u = snap.publishedUrl || snap.published_url || snap.url;
  return typeof u === "string" ? u : null;
}

/** Verify a single ledger entry's deployment and stamp verified_at on success. */
export async function verifyLedgerEntry(supabase: SupabaseClient, ledgerId: string): Promise<UrlVerification | null> {
  const { data: row } = await supabase
    .from("results_ledger")
    .select("id, project_id, action_type, outcome_snapshot, delta_summary")
    .eq("id", ledgerId)
    .single();
  if (!row) return null;
  const url = publishedUrlOf(row as LedgerRow);
  if (!url) return null;

  const expectSchema = (row as LedgerRow).action_type === "schema_deploy";
  const verification = await verifyUrlLive(url, { expectSchema });

  await supabase
    .from("results_ledger")
    .update({
      status: verification.ok ? "verified" : "completed",
      verified_at: verification.ok ? verification.checkedAt : null,
      delta_summary: { ...((row as LedgerRow).delta_summary || {}), verification },
    })
    .eq("id", ledgerId);

  return verification;
}

/**
 * Sweep recently-completed deployments that carry a published URL but aren't yet
 * verified, fetch each, and stamp verification. Bounded for cost/time.
 */
export async function verifyPendingDeployments(
  supabase: SupabaseClient,
  opts: { projectId?: string; limit?: number } = {}
): Promise<{ checked: number; verified: number }> {
  try {
    let q = supabase
      .from("results_ledger")
      .select("id, project_id, action_type, outcome_snapshot, delta_summary")
      .eq("status", "completed")
      .is("verified_at", null)
      .order("executed_at", { ascending: false })
      .limit(opts.limit ?? 50);
    if (opts.projectId) q = q.eq("project_id", opts.projectId);

    const { data: rows } = await q;
    const candidates = (rows || []).filter((r) => publishedUrlOf(r as LedgerRow));
    let verified = 0;
    for (const row of candidates) {
      const v = await verifyLedgerEntry(supabase, row.id);
      if (v?.ok) verified += 1;
    }
    return { checked: candidates.length, verified };
  } catch (error) {
    logProviderError("deploy.verifySweep", error, { projectId: opts.projectId });
    return { checked: 0, verified: 0 };
  }
}
