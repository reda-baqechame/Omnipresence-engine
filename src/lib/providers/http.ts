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
