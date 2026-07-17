import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateApiKey } from "@/lib/security/api-keys";
import { guardApiKeyEndpoint } from "@/lib/security/api-v1-guard";
import { McpRequestSchema } from "@/lib/validation/schemas";
import {
  MCP_PROTOCOL_VERSION,
  MCP_TOOLS,
  callMcpTool,
  McpToolError,
} from "@/lib/mcp/server";

/**
 * PresenceOS MCP endpoint (streamable HTTP, JSON-RPC 2.0).
 *
 * Connect from Claude Desktop / Cursor:
 *   { "url": "https://<app>/api/mcp", "headers": { "x-api-key": "omp_..." } }
 *
 * Auth is the same org-scoped API key as /api/v1/*; every tool call is
 * tenant-filtered inside callMcpTool. Notifications get 202 per spec.
 */

function rpcError(id: string | number | null, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });
}

function rpcResult(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id, result });
}

export async function POST(request: NextRequest) {
  const supabase = await createServiceClient();
  const ctx = await authenticateApiKey(supabase, request);
  if (!ctx) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }

  const limited = await guardApiKeyEndpoint(request, ctx.organizationId, "mcp", 300, 60 * 60 * 1000);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: body must be JSON");
  }

  const parsed = McpRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return rpcError(null, -32600, "Invalid Request: not a JSON-RPC 2.0 message");
  }
  const { id = null, method, params } = parsed.data;

  // Notifications (no id) are acknowledged without a body per streamable HTTP.
  if (id === null && method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202 });
  }

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "presenceos", version: "1.0.0" },
        instructions:
          "PresenceOS AI Search Proof & Action. Read measured visibility, pull this week's sprint fixes, mark items done, queue CMS fixes (human-approved before deploy), and trigger remeasures. Rates come from measured answers only.",
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
      const name = typeof p.name === "string" ? p.name : "";
      const args =
        p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
          ? (p.arguments as Record<string, unknown>)
          : {};
      if (!name) return rpcError(id, -32602, "params.name is required");
      try {
        const result = await callMcpTool(supabase, ctx.organizationId, name, args);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (error) {
        if (error instanceof McpToolError) {
          return rpcResult(id, {
            content: [{ type: "text", text: error.message }],
            isError: true,
          });
        }
        console.error("MCP tool call failed:", error);
        return rpcResult(id, {
          content: [{ type: "text", text: "Internal error executing tool" }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** Streamable HTTP GET (SSE stream) is not offered; clients fall back to POST. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
