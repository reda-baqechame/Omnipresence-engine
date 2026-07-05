/**
 * Bounded concurrency for Playwright captures — prevents OOM / runaway Railway
 * bills when many visibility scans hit the capture service in parallel.
 */
const MAX = Math.max(1, Number(process.env.AI_UI_CAPTURE_MAX_CONCURRENCY || 3));

let active = 0;
const queue: Array<() => void> = [];

function release(): void {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) next();
}

/**
 * Acquire a capture slot. Waits when at capacity instead of spawning unbounded
 * browser contexts.
 */
export async function withCaptureSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function captureConcurrencySnapshot(): { max: number; active: number; queued: number } {
  return { max: MAX, active, queued: queue.length };
}
