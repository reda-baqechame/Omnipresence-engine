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

export interface BreakerOptions {
  /** Consecutive failures before the circuit opens (default 5). */
  threshold?: number;
  /** How long to fast-fail once open, before a half-open trial (default 30s). */
  cooldownMs?: number;
}

export type CircuitStatus = "closed" | "open" | "half-open";

export function circuitStatus(key: string, options: BreakerOptions = {}): CircuitStatus {
  const { threshold = 5, cooldownMs = 30_000 } = options;
  const state = breakers.get(key);
  if (!state || state.failures < threshold) return "closed";
  return Date.now() - state.openedAt < cooldownMs ? "open" : "half-open";
}

/** Test/ops helper: clear breaker state for a key (or all keys). */
export function resetBreaker(key?: string): void {
  if (key) breakers.delete(key);
  else breakers.clear();
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
  const status = circuitStatus(key, { threshold, cooldownMs });
  if (status === "open") throw new CircuitOpenError(key);

  try {
    const result = await fn();
    breakers.delete(key); // success closes the circuit
    return result;
  } catch (error) {
    const state = breakers.get(key) ?? { failures: 0, openedAt: 0 };
    state.failures += 1;
    if (state.failures >= threshold) state.openedAt = Date.now();
    breakers.set(key, state);
    throw error;
  }
}
