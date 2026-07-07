/**
 * Lightweight provider/engine error logging.
 *
 * Refund-safety doctrine: a failed provider must NEVER silently render as a
 * false zero/empty (a user could think they're invisible when they're not).
 * Callers still degrade gracefully (return [], null, available:false), but the
 * failure is logged here so an operator can detect provider outages instead of
 * the error being swallowed in an empty `catch {}`.
 */
export function logProviderError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    level: "warn",
    scope,
    message,
    ...(context ? { context } : {}),
    at: new Date().toISOString(),
  };
  // Single structured line — easy to grep / ship to a log drain.
  console.warn(`[provider-error] ${JSON.stringify(payload)}`);
}

export type MetricTags = Record<string, string | number | boolean | undefined>;

/**
 * Minimal metrics layer — structured log lines today, swappable for a real
 * backend later without call-site changes.
 */
export function recordMetric(name: string, value: number, tags?: MetricTags): void {
  const payload = {
    level: "info",
    type: "metric",
    name,
    value,
    ...(tags ? { tags } : {}),
    at: new Date().toISOString(),
  };
  console.log(`[metric] ${JSON.stringify(payload)}`);
  bumpMetricCounter(name, value);
}

const METRIC_WINDOW_MS = 60 * 60 * 1000;
const metricCounters = new Map<string, number>();
let metricWindowStart = Date.now();

function bumpMetricCounter(name: string, delta = 1): void {
  rotateMetricWindowIfNeeded();
  metricCounters.set(name, (metricCounters.get(name) ?? 0) + delta);
}

function rotateMetricWindowIfNeeded(): void {
  if (Date.now() - metricWindowStart <= METRIC_WINDOW_MS) return;
  metricCounters.clear();
  metricWindowStart = Date.now();
}

/** Hourly rolling counters for SLO checks (rate_limit.rejected / api.request). */
export function getMetricCounter(name: string): number {
  rotateMetricWindowIfNeeded();
  return metricCounters.get(name) ?? 0;
}

export function recordApiRequest(): void {
  recordMetric("api.request", 1);
}

export function recordRateLimitRejected(namespace?: string): void {
  recordMetric("rate_limit.rejected", 1, namespace ? { namespace } : undefined);
}

export function recordSloBreach(slo: string, actual: number, target: number, tags?: MetricTags): void {
  const payload = {
    level: "error",
    type: "slo-breach",
    slo,
    actual,
    target,
    ...(tags ? { tags } : {}),
    at: new Date().toISOString(),
  };
  console.error(`[slo-breach] ${JSON.stringify(payload)}`);
}

export interface SentryDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/**
 * Pure DSN parser (https://PUBLIC_KEY@HOST/PROJECT_ID). Exported for tests.
 * Returns null for empty/malformed DSNs or ones missing a public key/project id.
 */
export function parseDsn(dsn: string | undefined | null): SentryDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId) return null;
    return { host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

/** Parse the env-configured Sentry DSN once, cached. */
let cachedDsn: SentryDsn | null | undefined;
function parseSentryDsn(): SentryDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;
  cachedDsn = parseDsn(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
  return cachedDsn;
}

/**
 * Capture a hard error to Sentry/APM. Dependency-free: posts a minimal event to
 * the Sentry store endpoint via the DSN when configured (no SDK needed, works in
 * edge + node), and always emits a structured error log. Fire-and-forget so it
 * never blocks or throws into the caller.
 */
export function captureException(
  scope: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    `[error] ${JSON.stringify({ level: "error", scope, message, ...(context ? { context } : {}), at: new Date().toISOString() })}`
  );

  const dsn = parseSentryDsn();
  if (!dsn) return;

  const event = {
    event_id: globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now()}`,
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: scope,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    message: { formatted: `[${scope}] ${message}` },
    extra: { stack, ...context },
  };

  // Fire-and-forget; swallow all failures (APM must never break the request).
  void fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=presenceos/1.0, sentry_key=${dsn.publicKey}`,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(2500),
  }).catch(() => {});
}
