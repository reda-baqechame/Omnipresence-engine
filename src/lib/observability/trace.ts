/**
 * Universal trace context (browser + Node + Edge safe — no async_hooks import).
 * For full async propagation on Node, middleware sets x-trace-id per request;
 * API handlers call bindTraceFromRequest() at entry.
 */
let activeTraceId: string | undefined;

export function newTraceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function withTraceId<T>(traceId: string, fn: () => T): T {
  const prev = activeTraceId;
  activeTraceId = traceId;
  try {
    return fn();
  } finally {
    activeTraceId = prev;
  }
}

export function getTraceId(): string | undefined {
  return activeTraceId;
}

export function ensureTraceId(existing?: string): string {
  const id = existing || activeTraceId || newTraceId();
  if (!activeTraceId) {
    return withTraceId(id, () => id);
  }
  return id;
}

/** Bind trace id from an incoming Request (x-trace-id / x-request-id). */
export function bindTraceFromRequest(request: Request): string {
  const id =
    request.headers.get("x-trace-id") ||
    request.headers.get("x-request-id") ||
    request.headers.get("x-vercel-id") ||
    newTraceId();
  return withTraceId(id, () => id);
}
