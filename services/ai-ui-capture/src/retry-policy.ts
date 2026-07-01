interface RetryOptions<T> {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number, result?: T) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions<T> = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 6000);
  const shouldRetry = options.shouldRetry ?? ((error) => Boolean(error));

  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const result = await fn();
      if (!shouldRetry(null, i, result) || i === attempts) return result;
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error, i) || i === attempts) throw error;
    }

    const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, i - 1));
    const jitter = Math.floor(Math.random() * Math.floor(baseDelayMs / 2));
    await sleep(backoff + jitter);
  }

  throw lastError instanceof Error ? lastError : new Error("retry exhausted");
}
