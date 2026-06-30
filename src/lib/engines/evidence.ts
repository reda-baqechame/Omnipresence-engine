/**
 * Evidence artifact spine (Wave N4).
 *
 * Turns every MEASURED AI/search probe into an auditable, tamper-evident record:
 * the raw answer, a sha256 `response_hash`, the REAL cited URLs/source domains,
 * and (when available) heavy artifacts (full-answer JSON, screenshot, DOM) in the
 * private `ai-evidence` Supabase Storage bucket. `visibility_results.evidence_url`
 * points back to this record. This is what lets us PROVE a result rather than
 * assert it.
 *
 * Honesty + cost guards:
 *  - Only real measured probes get evidence — never demo/simulated/unavailable.
 *  - Storage upload is best-effort: the DB row (hash + citations + excerpt) is the
 *    durable proof; heavy artifacts are an upgrade.
 *  - Retention is capped per project so storage cost can't run away.
 */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "ai-evidence";

/** Newest N evidence rows kept per project (older pruned). */
export const EVIDENCE_RETENTION_PER_PROJECT = Math.max(
  200,
  Math.floor(Number(process.env.AI_EVIDENCE_RETENTION) || 3000)
);

/** Deterministic sha256 of the answer text (tamper-evident fingerprint). */
export function responseHash(text: string): string {
  return createHash("sha256").update(text || "", "utf8").digest("hex");
}

export interface EvidenceInput {
  projectId: string;
  runId?: string | null;
  promptId?: string | null;
  engine: string;
  /** api | ui | search_result | model_knowledge */
  surfaceType?: string;
  prompt: string;
  measurementMode?: string | null;
  answer: string;
  citedUrls?: string[];
  sourceDomains?: string[];
  /** Optional heavy artifacts (only present from UI capture). */
  screenshotBase64?: string | null;
  domHtml?: string | null;
}

export interface EvidenceRecord {
  id: string;
  responseHash: string;
  /** Storage path of the durable artifact (signed-URL-able), or null. */
  evidenceUrl: string | null;
}

function safePathSegment(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
}

/**
 * Persist one evidence record (DB row + best-effort storage artifacts).
 * Returns null only on a hard DB failure (caller treats evidence as absent).
 */
export async function recordEvidence(
  supabase: SupabaseClient,
  input: EvidenceInput
): Promise<EvidenceRecord | null> {
  const hash = responseHash(input.answer);
  const id = randomUUID();
  const citedUrls = [...new Set((input.citedUrls || []).filter(Boolean))];
  const sourceDomains = [...new Set((input.sourceDomains || []).filter(Boolean))];

  const base = `${input.projectId}/${input.runId || "adhoc"}/${safePathSegment(input.engine)}-${hash.slice(0, 16)}`;
  let evidenceUrl: string | null = null;
  let screenshotPath: string | null = null;
  let domPath: string | null = null;

  // Best-effort heavy artifacts. Never let a storage hiccup fail the scan.
  try {
    const artifact = JSON.stringify({
      id,
      project_id: input.projectId,
      engine: input.engine,
      surface_type: input.surfaceType || "api",
      prompt: input.prompt,
      measurement_mode: input.measurementMode || null,
      response_hash: hash,
      answer: input.answer,
      cited_urls: citedUrls,
      source_domains: sourceDomains,
      captured_at: new Date().toISOString(),
    });
    const jsonPath = `${base}.json`;
    const up = await supabase.storage
      .from(BUCKET)
      .upload(jsonPath, artifact, { contentType: "application/json", upsert: true });
    if (!up.error) evidenceUrl = jsonPath;

    if (input.domHtml) {
      const dp = `${base}.dom.html`;
      const r = await supabase.storage
        .from(BUCKET)
        .upload(dp, input.domHtml, { contentType: "text/html", upsert: true });
      if (!r.error) domPath = dp;
    }
    if (input.screenshotBase64) {
      const png = Buffer.from(input.screenshotBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const sp = `${base}.png`;
      const r = await supabase.storage
        .from(BUCKET)
        .upload(sp, png, { contentType: "image/png", upsert: true });
      if (!r.error) screenshotPath = sp;
    }
  } catch {
    // storage unavailable — fall back to DB-only evidence
  }

  const { error } = await supabase.from("ai_capture_evidence").insert({
    id,
    project_id: input.projectId,
    run_id: input.runId || null,
    prompt_id: input.promptId || null,
    engine: input.engine,
    surface_type: input.surfaceType || "api",
    prompt: input.prompt.slice(0, 2000),
    measurement_mode: input.measurementMode || null,
    response_hash: hash,
    raw_answer: (input.answer || "").slice(0, 20000),
    cited_urls: citedUrls,
    source_domains: sourceDomains,
    screenshot_path: screenshotPath,
    dom_path: domPath,
    evidence_url: evidenceUrl,
  });
  if (error) return null;

  return { id, responseHash: hash, evidenceUrl };
}

/**
 * Prune evidence beyond the per-project retention cap (cost control). Best-effort.
 */
export async function enforceEvidenceRetention(
  supabase: SupabaseClient,
  projectId: string,
  max = EVIDENCE_RETENTION_PER_PROJECT
): Promise<number> {
  try {
    const { data } = await supabase
      .from("ai_capture_evidence")
      .select("id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .range(max, max + 1000);
    const ids = (data || []).map((r: { id: string }) => r.id);
    if (!ids.length) return 0;
    await supabase.from("ai_capture_evidence").delete().in("id", ids);
    return ids.length;
  } catch {
    return 0;
  }
}

interface ScanResultLike {
  prompt_id?: string;
  engine: string;
  prompt_text?: string;
  data_source?: string;
  measurement_mode?: string;
  source_domains?: string[];
  cited_urls?: string[];
  evidence_url?: string | null;
  raw_response?: Record<string, unknown> | null;
}

function answerOf(r: ScanResultLike): string {
  const raw = r.raw_response || {};
  const candidate = (raw.answer ?? raw.text) as unknown;
  return typeof candidate === "string" ? candidate : "";
}

/**
 * For each MEASURED visibility result with a real answer, create an evidence
 * record and stamp `evidence_url` back onto the result row (mutates in place).
 * Bounded by `maxRecords` so a huge scan can't explode storage writes.
 */
export async function attachEvidenceToResults(
  supabase: SupabaseClient,
  projectId: string,
  runId: string | null,
  results: ScanResultLike[],
  maxRecords = 200
): Promise<number> {
  let made = 0;
  for (const r of results) {
    if (made >= maxRecords) break;
    if (r.data_source !== "measured") continue;
    const answer = answerOf(r);
    if (!answer.trim() && !(r.cited_urls && r.cited_urls.length)) continue;
    const surfaceDetail = (r.raw_response?.data_source_detail as string) || "";
    const surfaceType = surfaceDetail === "ai_ui_capture" ? "ui" : surfaceDetail.startsWith("llm") || surfaceDetail === "perplexity" ? "api" : "search_result";
    const rec = await recordEvidence(supabase, {
      projectId,
      runId,
      promptId: r.prompt_id,
      engine: r.engine,
      surfaceType,
      prompt: r.prompt_text || "",
      measurementMode: r.measurement_mode,
      answer,
      citedUrls: r.cited_urls,
      sourceDomains: r.source_domains,
      screenshotBase64: (r.raw_response?.screenshot_base64 as string) || null,
      domHtml: (r.raw_response?.dom_html as string) || null,
    });
    if (rec) {
      // Prefer the storage artifact path; fall back to a stable DB reference.
      r.evidence_url = rec.evidenceUrl || `ai_capture_evidence:${rec.id}`;
      made++;
    }
  }
  if (made > 0) await enforceEvidenceRetention(supabase, projectId);
  return made;
}
