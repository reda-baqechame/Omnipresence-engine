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

interface SentryDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/** Parse a Sentry DSN (https://PUBLIC_KEY@HOST/PROJECT_ID) once, cached. */
let cachedDsn: SentryDsn | null | undefined;
function parseSentryDsn(): SentryDsn | null {
  if (cachedDsn !== undefined) return cachedDsn;
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return (cachedDsn = null);
  try {
    const u = new URL(dsn);
    cachedDsn = {
      host: u.host,
      projectId: u.pathname.replace(/^\//, ""),
      publicKey: u.username,
    };
  } catch {
    cachedDsn = null;
  }
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
