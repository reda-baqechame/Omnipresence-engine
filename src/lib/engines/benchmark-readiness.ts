/**
 * Staging benchmark readiness — mirrors scripts/check-staging-proof-readiness.mjs
 * for the ops UI. Never creates fake rows. Never calls paid providers.
 */

export interface EnvCheck {
  key: string;
  purpose: string;
  present: boolean;
  required: boolean;
}

export interface BenchmarkReadinessReport {
  generatedAt: string;
  env: EnvCheck[];
  migrationsOk: boolean;
  missingTables: string[];
  evidenceStarted: boolean;
  latestRunAt: string | null;
  rowCountLookback: number;
  warnings: string[];
  errors: string[];
  manualTriggerNotes: string[];
}

const REQUIRED_ENV: Array<{ key: string; purpose: string }> = [
  { key: "BENCHMARK_URLS", purpose: "crawl benchmark URLs" },
  { key: "BENCHMARK_DOMAINS", purpose: "backlink benchmark domains" },
  { key: "BENCHMARK_QUERIES", purpose: "SERP benchmark queries" },
  { key: "OMNIDATA_BASE_URL", purpose: "sovereign data service" },
  { key: "OMNIDATA_API_KEY", purpose: "OmniData auth" },
  { key: "OMNIDATA_SIGNING_SECRET", purpose: "request signing" },
  { key: "BENCHMARK_SECRET", purpose: "admin benchmark route bearer" },
];

const OPTIONAL_ENV: Array<{ key: string; purpose: string }> = [
  { key: "DATAFORSEO_LOGIN", purpose: "paid fallback comparison" },
  { key: "DATAFORSEO_PASSWORD", purpose: "paid fallback comparison" },
];

function envPresent(key: string): boolean {
  const v = process.env[key];
  return Boolean(v && v.length > 0 && !v.startsWith("your-"));
}

export function buildBenchmarkReadinessReport(opts?: {
  latestRunAt?: string | null;
  rowCountLookback?: number;
  migrationsOk?: boolean;
  missingTables?: string[];
}): BenchmarkReadinessReport {
  const warnings: string[] = [];
  const errors: string[] = [];

  const env: EnvCheck[] = [
    ...REQUIRED_ENV.map((e) => {
      const present = envPresent(e.key);
      if (!present) warnings.push(`Missing ${e.key}`);
      return { ...e, present, required: true };
    }),
    ...OPTIONAL_ENV.map((e) => ({
      ...e,
      present: envPresent(e.key),
      required: false,
    })),
  ];

  const migrationsOk = opts?.migrationsOk ?? true;
  const missingTables = opts?.missingTables ?? [];
  if (!migrationsOk) {
    errors.push(`Missing migration tables: ${missingTables.join(", ")}`);
  }

  const rowCountLookback = opts?.rowCountLookback ?? 0;
  const latestRunAt = opts?.latestRunAt ?? null;
  const evidenceStarted = rowCountLookback > 0 && Boolean(latestRunAt);
  if (!evidenceStarted) {
    warnings.push("Live benchmark proof has not started until benchmark_runs contains real rows.");
  }

  return {
    generatedAt: new Date().toISOString(),
    env,
    migrationsOk,
    missingTables,
    evidenceStarted,
    latestRunAt,
    rowCountLookback,
    warnings,
    errors,
    manualTriggerNotes: [
      "Never invent benchmark_runs rows.",
      "Use Inngest nightly-provider-benchmark or POST /api/admin/provider-benchmark with BENCHMARK_SECRET.",
      "Paid side-by-side only when DATAFORSEO_* configured and explicitly enabled for staging.",
      "See docs/audits/staging-benchmark-runbook.md",
    ],
  };
}
