import type { NextRequest } from "next/server";
import { checkRateLimitDistributed } from "@/lib/security/rate-limit";
import { recordApiRequest, recordRateLimitRejected } from "@/lib/observability/log";

function rateLimitResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSec || 60),
    },
  });
}

/** Per-org rate limit for authenticated public API routes (v1/*). */
export async function guardApiKeyEndpoint(
  request: NextRequest,
  organizationId: string,
  namespace: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  const result = await checkRateLimitDistributed(`api-v1:${namespace}:${organizationId}`, limit, windowMs);
  if (!result.allowed) {
    recordRateLimitRejected(`api-v1:${namespace}`);
    return rateLimitResponse(result.retryAfterSec || 60);
  }
  recordApiRequest();
  return null;
}

/** Per-org rate limit for session-authenticated mutation routes (billing, keys, scans). */
export async function guardOrgEndpoint(
  organizationId: string,
  namespace: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  const result = await checkRateLimitDistributed(`org:${namespace}:${organizationId}`, limit, windowMs);
  if (!result.allowed) {
    recordRateLimitRejected(`org:${namespace}`);
    return rateLimitResponse(result.retryAfterSec || 60);
  }
  recordApiRequest();
  return null;
}
