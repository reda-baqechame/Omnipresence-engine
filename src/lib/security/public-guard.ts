import type { NextRequest } from "next/server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/security/rate-limit";

export function guardPublicEndpoint(
  request: NextRequest,
  namespace: string,
  limit: number,
  windowMs: number
) {
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
