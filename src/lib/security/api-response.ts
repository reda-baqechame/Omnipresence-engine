import { NextResponse } from "next/server";
import { parseOrError } from "@/lib/validation/schemas";
import type { z } from "zod";

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

/**
 * Parse + validate a JSON request body against a zod schema. Returns either the
 * typed data or a ready-to-return 400 Response carrying the first validation
 * message. Never throws — a malformed body becomes a clean 400, not a 500.
 *
 * Usage:
 *   const parsed = await validateBody(request, OpsCreateSchema);
 *   if (parsed.response) return parsed.response;
 *   const { projectId } = parsed.data;
 */
export async function validateBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<{ data: T; response: null } | { data: null; response: NextResponse }> {
  const body = await readJsonBody(request);
  const result = parseOrError(schema, body);
  if (!result.ok) {
    return { data: null, response: apiError(result.error) };
  }
  return { data: result.data, response: null };
}
