/**
 * Minimal, dependency-free OmniData client for accuracy tests.
 *
 * Mirrors the auth/signing contract of src/lib/providers/dataforseo.ts
 * (Bearer key + optional HMAC over `${timestamp}.${JSON.stringify(body)}`) so
 * golden audits exercise the REAL sovereign endpoints over HTTP without
 * importing `@/`-aliased app modules (which don't load under node --test).
 */
import { createHmac } from "node:crypto";

export function omnidataBaseUrl(): string | null {
  const url = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
  return url ? `${url}/v3` : null;
}

function authHeaders(body: unknown): Record<string, string> {
  const key = process.env.OMNIDATA_API_KEY || "dev-local-key";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const secret = process.env.OMNIDATA_SIGNING_SECRET;
  if (secret) {
    const timestamp = String(Date.now());
    const payload = JSON.stringify(body);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    headers["x-omnidata-timestamp"] = timestamp;
    headers["x-omnidata-signature"] = signature;
  }
  return headers;
}

/** POST a DataForSEO-shaped task array; returns the first task's first result, or null. */
export async function omnidataPost<T = Record<string, unknown>>(
  endpoint: string,
  body: unknown[],
  timeoutMs = 30000
): Promise<T | null> {
  const base = omnidataBaseUrl();
  if (!base) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: authHeaders(body),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { tasks?: Array<{ result?: T[] }> };
    return json.tasks?.[0]?.result?.[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
