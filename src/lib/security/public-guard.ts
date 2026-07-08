import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  checkRateLimitDistributed,
  getClientIp,
  getClientIpFromHeaders,
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

/**
 * Rate-limit a public Server Component page (share/portal report views) by
 * client IP, using `next/headers`' header list instead of a NextRequest —
 * pages don't receive one. These pages can trigger the exact same expensive
 * on-demand regeneration (provider fan-out, LLM narrative, Playwright PDF
 * render) as the download route below when the report predates stored
 * artifacts, so an unauthenticated visitor hammering a share link is an
 * uncontrolled-spend vector, not just a UX nuisance. Returns
 * `{ allowed: false, retryAfterSec }` instead of a Response since Server
 * Components must return JSX.
 */
export async function checkPublicPageRateLimit(
  headers: { get(name: string): string | null },
  namespace: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const ip = getClientIpFromHeaders(headers);
  const result = await checkRateLimitDistributed(`${namespace}:${ip}`, limit, windowMs);
  if (!result.allowed) {
    recordRateLimitRejected(namespace);
    return { allowed: false, retryAfterSec: result.retryAfterSec || 60 };
  }
  return { allowed: true };
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
