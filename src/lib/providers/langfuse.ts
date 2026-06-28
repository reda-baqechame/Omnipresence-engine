import { fetchWithTimeout } from "./http";
import { logProviderError } from "@/lib/observability/log";

/**
 * Optional Langfuse (MIT core) mirror for AEO prompt observability. The
 * first-party Supabase `ai_probe_traces` table stays the source of truth; when
 * a self-hosted Langfuse is configured we ALSO mirror each probe as a trace for
 * ops-grade debugging/eval. Fully keyless-friendly and best-effort: any failure
 * is logged and swallowed so it never affects the scan pipeline.
 *
 * Configure: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY.
 */

export function hasLangfuse(): boolean {
  return Boolean(
    process.env.LANGFUSE_BASE_URL &&
      process.env.LANGFUSE_PUBLIC_KEY &&
      process.env.LANGFUSE_SECRET_KEY
  );
}

export interface LangfuseTraceInput {
  project_id: string;
  engine: string;
  prompt: string;
  response_excerpt: string | null;
  brand_mentioned: boolean;
  brand_cited: boolean;
  competitors_mentioned: string[];
  model: string | null;
  grounding_mode: string | null;
  checked_at: string;
}

function authHeader(): string {
  const token = Buffer.from(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
  ).toString("base64");
  return `Basic ${token}`;
}

/** Mirror probe traces to Langfuse via the public ingestion batch API. */
export async function mirrorTracesToLangfuse(traces: LangfuseTraceInput[]): Promise<boolean> {
  if (!hasLangfuse() || traces.length === 0) return false;
  const base = process.env.LANGFUSE_BASE_URL!.replace(/\/+$/, "");

  const batch = traces.map((t, i) => ({
    id: `${t.project_id}-${t.checked_at}-${i}`,
    type: "trace-create",
    timestamp: t.checked_at,
    body: {
      name: `aeo-probe:${t.engine}`,
      input: t.prompt,
      output: t.response_excerpt ?? "",
      metadata: {
        engine: t.engine,
        model: t.model,
        grounding_mode: t.grounding_mode,
        brand_mentioned: t.brand_mentioned,
        brand_cited: t.brand_cited,
        competitors_mentioned: t.competitors_mentioned,
      },
      tags: [
        "aeo",
        t.engine,
        t.brand_cited ? "cited" : t.brand_mentioned ? "mentioned" : "absent",
      ],
    },
  }));

  try {
    const res = await fetchWithTimeout(`${base}/api/public/ingestion`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ batch }),
      timeoutMs: 15000,
    });
    return res.ok;
  } catch (error) {
    logProviderError("langfuse.mirror", error);
    return false;
  }
}
