/**
 * Local semantic embeddings (Phase 3) — transformers.js, MIT, fully keyless.
 *
 * Runs the all-MiniLM-L6-v2 sentence model (~25MB) in-process so the platform
 * gets semantic similarity (content gaps, internal linking, clustering,
 * cannibalization) with ZERO per-call cost and no external API.
 *
 * @huggingface/transformers is an OPTIONAL dependency. It is loaded lazily via
 * an indirect import so the service still builds/runs when the package (or its
 * onnxruntime native binary) isn't installed — in which case we report
 * `available:false` instead of crashing. Refund-safety preserved.
 */

const MODEL_ID = process.env.EMBEDDINGS_MODEL || "Xenova/all-MiniLM-L6-v2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractorPromise: Promise<any> | null = null;
let loadFailed = false;

async function getExtractor(): Promise<unknown | null> {
  if (loadFailed) return null;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Indirect specifier so the type-checker/bundler doesn't hard-require the
      // optional package at build time.
      const pkg = "@huggingface/transformers";
      const mod = (await import(pkg)) as {
        pipeline: (task: string, model: string) => Promise<unknown>;
        env?: { allowLocalModels?: boolean };
      };
      if (mod.env) mod.env.allowLocalModels = false;
      return mod.pipeline("feature-extraction", MODEL_ID);
    })().catch((err) => {
      loadFailed = true;
      console.warn(`[omnidata] embeddings unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
  }
  return extractorPromise;
}

export interface EmbeddingsResult {
  available: boolean;
  model: string;
  dims: number;
  embeddings: number[][];
  data_source: "measured" | "unavailable";
  reason?: string;
}

export async function isEmbeddingsReady(): Promise<boolean> {
  const ex = await getExtractor();
  return ex != null;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingsResult> {
  const clean = texts.map((t) => (t || "").slice(0, 8000)).filter((t) => t.trim().length > 0);
  if (clean.length === 0) {
    return { available: false, model: MODEL_ID, dims: 0, embeddings: [], data_source: "unavailable", reason: "No input text" };
  }

  const extractor = await getExtractor();
  if (!extractor) {
    return {
      available: false,
      model: MODEL_ID,
      dims: 0,
      embeddings: [],
      data_source: "unavailable",
      reason: "transformers.js not installed",
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = extractor as (input: string[], opts: any) => Promise<{ tolist: () => number[][] } | number[][]>;
    const output = await run(clean, { pooling: "mean", normalize: true });
    const embeddings: number[][] =
      typeof (output as { tolist?: () => number[][] }).tolist === "function"
        ? (output as { tolist: () => number[][] }).tolist()
        : (output as number[][]);
    return {
      available: true,
      model: MODEL_ID,
      dims: embeddings[0]?.length ?? 0,
      embeddings,
      data_source: "measured",
    };
  } catch (err) {
    return {
      available: false,
      model: MODEL_ID,
      dims: 0,
      embeddings: [],
      data_source: "unavailable",
      reason: err instanceof Error ? err.message : "Embedding failed",
    };
  }
}
