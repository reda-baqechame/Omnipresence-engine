import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  checkRateLimitDistributed,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { recordRateLimitRejected } from "@/lib/observability/log";

/**
 * Rate-limit a public endpoint by client IP. Uses the distributed (Upstash)
 * limiter when configured so the cap holds across all serverless instances and
 * regions — a single in-memory bucket per instance is trivially bypassed in
 * production. Falls back to the in-memory limiter automatically (fail-open) when
 * Upstash isn't configured or has a transient error. Returns a 429 Response when
 * the limit is exceeded, otherwise null.
 */
export async function guardPublicEndpoint(
  request: NextRequest,
  namespace: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  const ip = getClientIp(request);
  const result = await checkRateLimitDistributed(`${namespace}:${ip}`, limit, windowMs);
  if (!result.allowed) {
    recordRateLimitRejected(namespace);
    return rateLimitResponse(result.retryAfterSec || 60);
  }
  return null;
}

/** Synchronous in-memory-only guard for hot paths that must not await Redis. */
export function guardPublicEndpointSync(
  request: NextRequest,
  namespace: string,
  limit: number,
  windowMs: number
): Response | null {
  const ip = getClientIp(request);
  const result = checkRateLimit(`${namespace}:${ip}`, limit, windowMs);
  if (!result.allowed) {
    return rateLimitResponse(result.retryAfterSec || 60);
  }
  return null;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}
