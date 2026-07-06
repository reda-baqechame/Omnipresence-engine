import type { NextRequest } from "next/server";
import { checkRateLimitDistributed } from "@/lib/security/rate-limit";

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
    return new Response(JSON.stringify({ error: "API rate limit exceeded. Try again later." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSec || 60),
      },
    });
  }
  return null;
}
