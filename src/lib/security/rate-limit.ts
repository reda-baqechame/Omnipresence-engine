import type { NextRequest } from "next/server";
import { hasUpstashRedisRest, hasDistributedRateLimitBackend, resolveUpstashRedisRest } from "@/lib/security/upstash-env";
import { getOmniDataHeaders } from "@/lib/security/engine-auth";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true };
}

export function rateLimitResponse(retryAfterSec: number) {
  return new Response(JSON.stringify({ error: "Too many requests. Try again later." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec),
    },
  });
}

/**
 * Distributed rate limiting via Upstash Redis (REST). On serverless/multi-region
 * the in-memory bucket above is per-instance and trivially bypassed, so when
 * UPSTASH_REDIS_REST_URL + token are configured we count atomically in Redis
 * (INCR + first-hit PEXPIRE). Falls back to the in-memory limiter when Upstash
 * isn't configured or the call fails (fail-open, never block real users on a
 * limiter outage). Use this for sensitive/public endpoints.
 */
export async function checkRateLimitDistributed(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec?: number; backend: "redis" | "omnidata" | "memory" }> {
  const creds = resolveUpstashRedisRest();

  if (creds) {
    const { url, token } = creds;
    const redisKey = `rl:${key}`;
    try {
      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["INCR", redisKey],
          ["PTTL", redisKey],
        ]),
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`upstash ${res.status}`);
      const out = (await res.json()) as Array<{ result: number }>;
      const count = Number(out?.[0]?.result ?? 0);
      let ttl = Number(out?.[1]?.result ?? -1);

      if (count === 1 || ttl < 0) {
        await fetch(`${url}/pexpire/${encodeURIComponent(redisKey)}/${windowMs}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(2000),
        });
        ttl = windowMs;
      }

      if (count > limit) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(ttl / 1000)), backend: "redis" };
      }
      return { allowed: true, backend: "redis" };
    } catch {
      /* fall through to OmniData / memory */
    }
  }

  const base = process.env.OMNIDATA_BASE_URL?.replace(/\/$/, "");
  if (base && hasDistributedRateLimitBackend()) {
    try {
      const body = [{ key, limit, window_ms: windowMs }];
      const res = await fetch(`${base}/v3/internal/ratelimit`, {
        method: "POST",
        headers: getOmniDataHeaders(body),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          tasks?: Array<{ result?: Array<{ allowed?: boolean; retry_after_sec?: number | null }> }>;
        };
        const row = json?.tasks?.[0]?.result?.[0];
        if (typeof row?.allowed === "boolean") {
          if (!row.allowed && row.retry_after_sec) {
            return {
              allowed: false,
              retryAfterSec: row.retry_after_sec,
              backend: "omnidata",
            };
          }
          return { allowed: row.allowed, backend: "omnidata" };
        }
      }
    } catch {
      /* fail-open below */
    }
  }

  return { ...checkRateLimit(key, limit, windowMs), backend: "memory" };
}
