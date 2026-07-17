import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSprintItems, sprintWeekStart, type SprintItem } from "@/lib/engines/action-sprint";
import { calculateVisibilityMetrics } from "@/lib/engines/visibility-scanner";
import { triggerProjectScan } from "@/lib/engines/trigger-scan";
import type { VisibilityResult } from "@/types/database";

/**
 * PresenceOS MCP server (Master Plan v4 feature 5, Trakkr/Peec pattern).
 *
 * A minimal streamable-HTTP MCP implementation: Claude/Cursor connect with an
 * `omp_...` API key and can read measured gaps, pull copy-paste fixes, mark
 * sprint items done, queue CMS fixes for the ops executor, and trigger a
 * remeasure — the full measure -> fix -> deploy -> prove loop from an agent.
 *
 * Every tool is scoped to the API key's organization; the org filter is
 * enforced here on every query, never trusted from the caller.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: ToolDef[] = [
  {
    name: "list_projects",
    description: "List the organization's projects (id, name, domain, status).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_visibility_summary",
    description:
      "Measured AI-visibility summary for a project: mention rate, citation rate, and sample size computed from measured answers only.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Project UUID" } },
      required: ["projectId"],
    },
  },
  {
    name: "get_current_sprint",
    description:
      "This week's action sprint for a project: prioritized fix items (technical / content / sources) with copy-paste fixes where available, plus baseline and status.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Project UUID" } },
      required: ["projectId"],
    },
  },
  {
    name: "list_gap_fixes",
    description:
      "Open technical findings for a project with severity and copy-paste fix recommendations — the raw material for fixes an agent can apply.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Project UUID" } },
      required: ["projectId"],
    },
  },
  {
    name: "complete_sprint_item",
    description: "Mark one item of the project's current sprint as done (by index).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        itemIndex: { type: "number", description: "0-based index into the sprint's items" },
      },
      required: ["projectId", "itemIndex"],
    },
  },
  {
    name: "queue_cms_fix",
    description:
      "Queue a content publish or patch for the project's connected CMS (WordPress/Webflow). The item lands in the ops queue as PENDING and requires human approval in-app before it executes — nothing deploys silently.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project UUID" },
        title: { type: "string", description: "Human-readable title of the fix" },
        content: { type: "string", description: "Full content/patch body to publish" },
        platform: { type: "string", enum: ["wordpress", "webflow"], description: "CMS platform (default wordpress)" },
      },
      required: ["projectId", "title", "content"],
    },
  },
  {
    name: "trigger_remeasure",
    description:
      "Rerun the visibility panel for a project so before/after deltas are computed on fresh measured data. No-op if a scan is already running.",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Project UUID" } },
      required: ["projectId"],
    },
  },
];

export class McpToolError extends Error {}

/** Resolve a project only if it belongs to the key's org — the tenancy gate. */
async function requireOrgProject(
  supabase: SupabaseClient,
  organizationId: string,
  projectId: unknown
): Promise<{ id: string; organization_id: string; domain: string; name: string }> {
  if (typeof projectId !== "string" || !projectId) {
    throw new McpToolError("projectId (string) is required");
  }
  const { data } = await supabase
    .from("projects")
    .select("id, organization_id, domain, name")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) throw new McpToolError("Project not found for this API key");
  return data;
}

export async function callMcpTool(
  supabase: SupabaseClient,
  organizationId: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      const { data } = await supabase
        .from("projects")
        .select("id, name, domain, status, last_scan_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100);
      return { projects: data || [] };
    }

    case "get_visibility_summary": {
      const project = await requireOrgProject(supabase, organizationId, args.projectId);
      const { data } = await supabase
        .from("visibility_results")
        .select("brand_mentioned, brand_cited, competitor_mentions, raw_response, data_source, recommendation_strength, answer_position, confidence, engine")
        .eq("project_id", project.id)
        .limit(1000);
      const metrics = calculateVisibilityMetrics((data || []) as VisibilityResult[]);
      return {
        project: { id: project.id, name: project.name, domain: project.domain },
        mention_rate: metrics.mentionRate,
        citation_rate: metrics.citationRate,
        sample_size: metrics.sampleSize,
        note: "Rates computed from measured answers only — unavailable probes are excluded, never counted as absence.",
      };
    }

    case "get_current_sprint": {
      const project = await requireOrgProject(supabase, organizationId, args.projectId);
      const weekStart = sprintWeekStart();
      const { data: sprint } = await supabase
        .from("action_sprints")
        .select("id, week_start, status, items, baseline, outcome, outcome_verdict")
        .eq("project_id", project.id)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (sprint) return { sprint };
      // No sprint proposed yet — build a preview from measured gaps so the
      // agent still gets actionable items (read-only; nothing is persisted).
      const items = await buildSprintItems(supabase, project.id, project.domain);
      return { sprint: null, proposed_items_preview: items };
    }

    case "list_gap_fixes": {
      const project = await requireOrgProject(supabase, organizationId, args.projectId);
      const { data } = await supabase
        .from("technical_findings")
        .select("title, severity, category, description, fix_recommendation")
        .eq("project_id", project.id)
        .eq("is_resolved", false)
        .order("severity", { ascending: true })
        .limit(50);
      return { fixes: data || [] };
    }

    case "complete_sprint_item": {
      const project = await requireOrgProject(supabase, organizationId, args.projectId);
      const idx = args.itemIndex;
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
        throw new McpToolError("itemIndex (non-negative integer) is required");
      }
      const weekStart = sprintWeekStart();
      const { data: sprint } = await supabase
        .from("action_sprints")
        .select("id, items, status")
        .eq("project_id", project.id)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (!sprint) throw new McpToolError("No sprint this week — call get_current_sprint first");
      if (sprint.status !== "active") throw new McpToolError(`Sprint is ${sprint.status}, not active`);
      const items = (sprint.items || []) as SprintItem[];
      if (idx >= items.length) throw new McpToolError(`itemIndex out of range (sprint has ${items.length} items)`);
      items[idx] = { ...items[idx], done: true };
      await supabase.from("action_sprints").update({ items }).eq("id", sprint.id);
      return { ok: true, item: items[idx] };
    }

    case "queue_cms_fix": {
      const project = await requireOrgProject(supabase, organizationId, args.projectId);
      const title = typeof args.title === "string" ? args.title.trim() : "";
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!title || !content) throw new McpToolError("title and content are required");
      const platform = args.platform === "webflow" ? "webflow" : "wordpress";
      const { data: row, error } = await supabase
        .from("ops_queue")
        .insert({
          project_id: project.id,
          organization_id: organizationId,
          action_type: "cms_patch",
          title: title.slice(0, 300),
          payload: { platform, title: title.slice(0, 300), content, source: "mcp" },
          risk_level: "medium",
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new McpToolError(`Queue insert failed: ${error.message}`);
      return {
        ok: true,
        opsId: row.id,
        status: "pending",
        note: "Queued for human approval in the app's ops console. It will deploy via the connected CMS once approved, then appear in the proof ledger.",
      };
    }

    case "trigger_remeasure": {
      const project = await requireOrgProject(supabase, organizationId, args.projectId);
      const { data: claimed } = await supabase
        .from("projects")
        .update({ status: "scanning" })
        .eq("id", project.id)
        .neq("status", "scanning")
        .select("id")
        .maybeSingle();
      if (!claimed) return { ok: true, started: false, note: "A scan is already running." };
      await triggerProjectScan(project.id, project.organization_id);
      return { ok: true, started: true };
    }

    default:
      throw new McpToolError(`Unknown tool: ${name}`);
  }
}