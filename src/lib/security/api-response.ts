import { NextResponse } from "next/server";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function apiUnauthorized() {
  return apiError("Unauthorized", 401);
}

export function apiForbidden() {
  return apiError("Forbidden", 403);
}

export function apiNotFound() {
  return apiError("Not found", 404);
}

export function apiServerError(logContext: string, error?: unknown) {
  if (error) console.error(logContext, error);
  return apiError("Request failed", 500);
}

/**
 * Parse a JSON request body without ever throwing. A malformed or empty body
 * resolves to the provided fallback (default `{}`) so route handlers return a
 * clean 400 from their own validation instead of an unhandled SyntaxError 500.
 *
 * Defaults to `any` to be a drop-in for the native `request.json()` (which is
 * also typed `any`); callers that want a typed body can pass an explicit generic.
 */
export async function readJsonBody<T = any>(
  request: Request,
  fallback: T = {} as T
): Promise<T> {
  try {
    const body = await request.json();
    return (body ?? fallback) as T;
  } catch {
    return fallback;
  }
}
