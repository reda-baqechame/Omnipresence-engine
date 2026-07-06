import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { newTraceId } from "@/lib/observability/trace";

function attachTraceId(request: NextRequest): string {
  const traceId =
    request.headers.get("x-trace-id") ||
    request.headers.get("x-request-id") ||
    request.headers.get("x-vercel-id") ||
    newTraceId();
  request.headers.set("x-trace-id", traceId);
  return traceId;
}

export async function proxy(request: NextRequest) {
  const traceId = attachTraceId(request);
  const response = await updateSession(request);
  response.headers.set("x-trace-id", traceId);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
