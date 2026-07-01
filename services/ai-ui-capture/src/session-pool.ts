export type CaptureSurface =
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "google_ai_overview"
  | "bing_copilot";

const PRIVATE_SURFACES = new Set<CaptureSurface>(["chatgpt", "gemini"]);
const poolCursor = new Map<string, number>();

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function envKeyForSurface(surface: CaptureSurface): string {
  return `AI_UI_CAPTURE_STORAGE_STATES_${surface.toUpperCase()}`;
}

function storageStatesFor(surface: CaptureSurface): string[] {
  const surfaceSpecific = parseCsvList(process.env[envKeyForSurface(surface)]);
  if (surfaceSpecific.length > 0) return surfaceSpecific;

  const sharedPool = parseCsvList(process.env.AI_UI_CAPTURE_STORAGE_STATES);
  if (sharedPool.length > 0) return sharedPool;

  const legacySingle = process.env.AI_UI_CAPTURE_STORAGE_STATE?.trim();
  return legacySingle ? [legacySingle] : [];
}

export function hasSessionStateForSurface(surface: CaptureSurface): boolean {
  if (!PRIVATE_SURFACES.has(surface)) return true;
  return storageStatesFor(surface).length > 0;
}

/**
 * Returns the next storage state for a surface using round-robin rotation.
 * For public/keyless surfaces this may return undefined.
 */
export function nextStorageStateForSurface(surface: CaptureSurface): string | undefined {
  const states = storageStatesFor(surface);
  if (states.length === 0) return undefined;
  const key = surface;
  const current = poolCursor.get(key) ?? 0;
  const next = states[current % states.length];
  poolCursor.set(key, (current + 1) % states.length);
  return next;
}
