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
