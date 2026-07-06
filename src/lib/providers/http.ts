/**
 * Shared HTTP utilities for provider calls. Centralizes the production-grade
 * concerns every external call needs: a hard timeout (so a hung upstream can
 * never wedge a serverless function) and optional retry-with-backoff for
 * transient 429/5xx failures.
 */

export interface FetchWithTimeoutInit extends RequestInit {
  /** Abort the request after this many ms (default 15000). */
  timeoutMs?: number;
}

/**
 * fetch() with a guaranteed timeout. If the caller supplies its own `signal`
 * we respect it; otherwise we attach an AbortSignal.timeout so the request
 * cannot hang indefinitely.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: FetchWithTimeoutInit = {}
): Promise<Response> {
  const { timeoutMs = 15000, signal, ...rest } = init;
  return fetch(input, {
    ...rest,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Return false to stop retrying for a given error (default: always retry). */
  shouldRetry?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with exponential backoff + jitter. Use for idempotent provider GETs
 * / search calls where a transient 429/5xx is worth one or two more attempts.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseDelayMs = 400, shouldRetry } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      if (shouldRetry && !shouldRetry(error)) break;
      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 150);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** True for HTTP statuses that are usually worth retrying. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

// --- Circuit breaker --------------------------------------------------------
// A flapping or down upstream shouldn't make every request pay the full timeout
// (15s x N providers) before degrading. After `threshold` consecutive failures
// for a key we "open" the circuit and fast-fail for `cooldownMs`, then allow a
// single half-open trial. Process-local (per serverless instance) — enough to
// stop a hot loop from hammering a dead provider and blowing latency budgets.

export class CircuitOpenError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`circuit open: ${key}`);
    this.name = "CircuitOpenError";
    this.key = key;
  }
}

interface BreakerState {
  failures: number;
  openedAt: number;
}

const breakers = new Map<string, BreakerState>();
const breakerCache = new Map<string, { state: BreakerState; fetchedAt: number }>();
const BREAKER_CACHE_MS = 2_000;

async function redisGetBreaker(key: string): Promise<BreakerState | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(`cb:${key}`)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { result?: string | null };
    if (!out.result) return null;
    return JSON.parse(out.result) as BreakerState;
  } catch {
    return null;
  }
}

async function redisSetBreaker(key: string, state: BreakerState | null): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    if (!state) {
      await fetch(`${url}/del/${encodeURIComponent(`cb:${key}`)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1500),
      });
      return;
    }
    await fetch(`${url}/set/${encodeURIComponent(`cb:${key}`)}/${encodeURIComponent(JSON.stringify(state))}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* fail-open */
  }
}

async function loadBreakerState(key: string): Promise<BreakerState> {
  const cached = breakerCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < BREAKER_CACHE_MS) {
    return cached.state;
  }
  const fromRedis = await redisGetBreaker(key);
  const state = fromRedis ?? breakers.get(key) ?? { failures: 0, openedAt: 0 };
  breakers.set(key, state);
  breakerCache.set(key, { state, fetchedAt: Date.now() });
  return state;
}

async function persistBreakerState(key: string, state: BreakerState | null): Promise<void> {
  if (!state) {
    breakers.delete(key);
    breakerCache.delete(key);
    await redisSetBreaker(key, null);
    return;
  }
  breakers.set(key, state);
  breakerCache.set(key, { state, fetchedAt: Date.now() });
  await redisSetBreaker(key, state);
}

export interface BreakerOptions {
  /** Consecutive failures before the circuit opens (default 5). */
  threshold?: number;
  /** How long to fast-fail once open, before a half-open trial (default 30s). */
  cooldownMs?: number;
}

export type CircuitStatus = "closed" | "open" | "half-open";

/** Derive circuit status from a loaded breaker state (shared by withBreaker + circuitStatus). */
export function circuitStatusFromState(
  state: BreakerState | null | undefined,
  options: BreakerOptions = {}
): CircuitStatus {
  const { threshold = 5, cooldownMs = 30_000 } = options;
  if (!state || state.failures < threshold) return "closed";
  return Date.now() - state.openedAt < cooldownMs ? "open" : "half-open";
}

/** Read breaker state from Redis (when configured) + process cache — same path as withBreaker. */
export async function circuitStatus(key: string, options: BreakerOptions = {}): Promise<CircuitStatus> {
  const state = await loadBreakerState(key);
  return circuitStatusFromState(state, options);
}

/** Test/ops helper: clear breaker state for a key (or all keys). */
export function resetBreaker(key?: string): void {
  if (key) {
    breakers.delete(key);
    breakerCache.delete(key);
    void redisSetBreaker(key, null);
  } else {
    breakers.clear();
    breakerCache.clear();
  }
}

/**
 * Wrap an external call with the circuit breaker. When the circuit is open it
 * throws `CircuitOpenError` immediately (callers should catch and degrade
 * gracefully — never a false zero). A success closes the circuit; a failure in
 * half-open re-opens it.
 */
export async function withBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  options: BreakerOptions = {}
): Promise<T> {
  const { threshold = 5, cooldownMs = 30_000 } = options;
  const state = await loadBreakerState(key);
  const status =
    state.failures < threshold
      ? "closed"
      : Date.now() - state.openedAt < cooldownMs
        ? "open"
        : "half-open";
  if (status === "open") throw new CircuitOpenError(key);

  try {
    const result = await fn();
    await persistBreakerState(key, null);
    return result;
  } catch (error) {
    const next = { failures: state.failures + 1, openedAt: state.openedAt };
    if (next.failures >= threshold) next.openedAt = Date.now();
    await persistBreakerState(key, next);
    throw error;
  }
}
