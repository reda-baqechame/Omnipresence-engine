/**
 * Fetch /api/health with optional operator auth (HEALTH_ADMIN_SECRET bearer).
 * Public callers receive only `{ ok: true, status: "healthy" }`.
 */

export function isPublicHealthPayload(json) {
  return Boolean(json?.ok) && !json?.checks && !json?.production;
}

export function healthAuthHeaders() {
  const secret = process.env.HEALTH_ADMIN_SECRET?.trim();
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

/** @param {string} base */
export async function fetchHealth(base, opts = {}) {
  const timeout = opts.timeout ?? 30_000;
  const res = await fetch(`${base.replace(/\/$/, "")}/api/health`, {
    signal: AbortSignal.timeout(timeout),
    headers: { ...healthAuthHeaders(), ...opts.headers },
  });
  if (!res.ok) {
    throw new Error(`/api/health → ${res.status}`);
  }
  const json = await res.json();
  return {
    health: json,
    mode: isPublicHealthPayload(json) ? "public" : "admin",
  };
}
