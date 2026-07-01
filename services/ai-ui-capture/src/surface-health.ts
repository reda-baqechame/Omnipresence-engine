import type { CaptureSurface } from "./session-pool.js";

interface SurfaceCounters {
  attempts: number;
  success: number;
  blocked: number;
  ungrounded: number;
  failed: number;
  updatedAt: string;
}

const SURFACES: CaptureSurface[] = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "bing_copilot"];

const counters = new Map<CaptureSurface, SurfaceCounters>(
  SURFACES.map((surface) => [
    surface,
    { attempts: 0, success: 0, blocked: 0, ungrounded: 0, failed: 0, updatedAt: new Date(0).toISOString() },
  ])
);

function touch(surface: CaptureSurface, mutate: (c: SurfaceCounters) => void): void {
  const row = counters.get(surface);
  if (!row) return;
  mutate(row);
  row.updatedAt = new Date().toISOString();
}

export function markSurfaceSuccess(surface: CaptureSurface): void {
  touch(surface, (c) => {
    c.attempts += 1;
    c.success += 1;
  });
}

export function markSurfaceBlocked(surface: CaptureSurface): void {
  touch(surface, (c) => {
    c.attempts += 1;
    c.blocked += 1;
  });
}

export function markSurfaceUngrounded(surface: CaptureSurface): void {
  touch(surface, (c) => {
    c.attempts += 1;
    c.ungrounded += 1;
  });
}

export function markSurfaceFailed(surface: CaptureSurface): void {
  touch(surface, (c) => {
    c.attempts += 1;
    c.failed += 1;
  });
}

export function getSurfaceHealthSnapshot(): {
  surfaces: Record<
    CaptureSurface,
    SurfaceCounters & {
      successRate: number;
      blockedRate: number;
    }
  >;
  totals: { attempts: number; success: number; blocked: number; ungrounded: number; failed: number };
} {
  const surfaces = {} as Record<
    CaptureSurface,
    SurfaceCounters & {
      successRate: number;
      blockedRate: number;
    }
  >;
  const totals = { attempts: 0, success: 0, blocked: 0, ungrounded: 0, failed: 0 };

  for (const surface of SURFACES) {
    const row = counters.get(surface)!;
    totals.attempts += row.attempts;
    totals.success += row.success;
    totals.blocked += row.blocked;
    totals.ungrounded += row.ungrounded;
    totals.failed += row.failed;
    surfaces[surface] = {
      ...row,
      successRate: row.attempts > 0 ? Number((row.success / row.attempts).toFixed(4)) : 0,
      blockedRate: row.attempts > 0 ? Number((row.blocked / row.attempts).toFixed(4)) : 0,
    };
  }

  return { surfaces, totals };
}
