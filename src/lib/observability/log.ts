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
