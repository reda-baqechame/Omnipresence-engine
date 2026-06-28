import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import {
  apiError,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  readJsonBody,
} from "@/lib/security/api-response";
import { parseServerLogs, type ParsedLogHit } from "@/lib/engines/agent-analytics";
import { classifyCrawler } from "@/lib/tracking/ai-crawlers";

const MAX_HITS_PER_REQUEST = 50_000;

interface StructuredHit {
  userAgent?: unknown;
  path?: unknown;
  statusCode?: unknown;
  hitAt?: unknown;
}

/** Normalize a structured hit forwarded from a customer's edge/CDN middleware. */
function normalizeStructuredHit(h: StructuredHit): ParsedLogHit | null {
  const ua = typeof h.userAgent === "string" ? h.userAgent : "";
  const info = classifyCrawler(ua);
  if (!info) return null;
  let hitAt = new Date().toISOString();
  if (typeof h.hitAt === "string") {
    const d = new Date(h.hitAt);
    if (!Number.isNaN(d.getTime())) hitAt = d.toISOString();
  }
  const statusCode =
    typeof h.statusCode === "number" && Number.isFinite(h.statusCode) ? Math.trunc(h.statusCode) : null;
  return {
    bot: info.bot,
    vendor: info.vendor,
    purpose: info.purpose,
    path: typeof h.path === "string" ? h.path.slice(0, 500) : null,
    statusCode,
    userAgent: ua.slice(0, 300),
    hitAt,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const access = await verifyProjectAccess(supabase, id, user.id, "member");
  if (!access) return apiForbidden();

  const body = await readJsonBody<{ logs?: unknown; hits?: unknown }>(request);

  let parsed: ParsedLogHit[] = [];

  if (typeof body.logs === "string" && body.logs.trim()) {
    parsed = parseServerLogs(body.logs);
  } else if (Array.isArray(body.hits)) {
    parsed = (body.hits as StructuredHit[])
      .map(normalizeStructuredHit)
      .filter((h): h is ParsedLogHit => h !== null);
  } else {
    return apiError("Provide either `logs` (raw access-log text) or `hits` (array of {userAgent,path,statusCode,hitAt}).");
  }

  if (parsed.length === 0) {
    return NextResponse.json({
      ingested: 0,
      message: "No AI crawler hits found. Only AI agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, …) are recorded; human and generic-bot traffic is ignored.",
    });
  }

  const rows = parsed.slice(0, MAX_HITS_PER_REQUEST).map((h) => ({
    project_id: id,
    bot: h.bot,
    vendor: h.vendor,
    purpose: h.purpose,
    path: h.path,
    status_code: h.statusCode,
    user_agent: h.userAgent,
    hit_at: h.hitAt,
  }));

  try {
    const { error } = await supabase.from("ai_crawler_hits").insert(rows);
    if (error) return apiServerError("Failed to store crawler hits", error);
  } catch (error) {
    return apiServerError("Failed to store crawler hits", error);
  }

  return NextResponse.json({
    ingested: rows.length,
    bots: [...new Set(rows.map((r) => r.bot))],
    truncated: parsed.length > MAX_HITS_PER_REQUEST,
  });
}
