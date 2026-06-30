/**
 * Ops queue executor (Wave Q1).
 *
 * Replaces the old ledger-only "execute" (which marked work done without doing
 * it) with a typed dispatcher: each `action_type` routes to its REAL runner
 * (CMS publish, schema deploy, IndexNow, GBP post, social schedule). The runner
 * returns a structured result; the worker writes it back to `ops_queue` and the
 * results ledger so the proof chain is honest — unsupported actions fail with a
 * clear reason instead of silently "completing".
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProjectIntegration, publishViaCms, type CmsCredentials, type CmsPlatform } from "@/lib/integrations/store";
import { submitIndexNow } from "@/lib/engines/indexnow";
import { deploySchemaToWordPress, deploySchemaToWebflow } from "@/lib/engines/schema-engine";
import { createGBPLocalPost } from "@/lib/providers/gbp";
import { scheduleViaAyrshare } from "@/lib/providers/social/ayrshare";
import { scheduleViaBuffer } from "@/lib/providers/social/buffer";
import { getValidOAuthToken } from "@/lib/oauth/tokens";
import { recordLedgerAction } from "@/lib/engines/results-ledger";
import { captureException } from "@/lib/observability/log";
import { inngest } from "@/lib/inngest/client";
import { estimateActionImpact } from "@/lib/engines/impact-estimate";
import { sendEmail } from "@/lib/email/transport";
import { buildLlmsTxt, buildReviewRequest, buildOutreachEmail } from "@/lib/engines/generators";

interface LlmsKeyPage {
  title: string;
  url: string;
  summary?: string;
}

export interface OpsItem {
  id: string;
  project_id: string;
  organization_id: string;
  action_type: string;
  title: string;
  payload: Record<string, unknown> | null;
  task_id?: string | null;
}

export interface OpsExecutionResult {
  ok: boolean;
  publishedUrl?: string;
  result?: Record<string, unknown>;
  error?: string;
  surface?: string;
}

async function projectDomain(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data } = await supabase.from("projects").select("domain").eq("id", projectId).single();
  return data?.domain ?? null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Route one ops item to its real runner. Pure dispatch — persistence is the caller's job. */
export async function executeOpsItem(supabase: SupabaseClient, item: OpsItem): Promise<OpsExecutionResult> {
  const payload = item.payload || {};
  const type = item.action_type;

  try {
    switch (type) {
      case "content_publish":
      case "content_published":
      case "cms_patch": {
        const platform = (asString(payload.platform) || "wordpress") as CmsPlatform;
        const title = asString(payload.title);
        const content = asString(payload.content);
        if (!title || !content) return { ok: false, error: "payload.title and payload.content required" };
        const creds = await loadProjectIntegration<CmsCredentials>(supabase, item.project_id, platform);
        if (!creds?.apiKey) return { ok: false, error: `No ${platform} integration configured`, surface: platform };
        const res = await publishViaCms(platform, creds, { title, content });
        if (!res.ok) return { ok: false, error: `${platform} publish failed`, surface: platform };
        // Mark the linked asset published + ping IndexNow.
        const assetId = asString(payload.assetId);
        if (assetId) {
          await supabase.from("content_assets").update({ status: "published", published_url: res.publishedUrl }).eq("id", assetId);
        }
        const domain = await projectDomain(supabase, item.project_id);
        if (res.publishedUrl && domain) await submitIndexNow([res.publishedUrl], domain).catch(() => 0);
        return { ok: true, publishedUrl: res.publishedUrl, surface: platform, result: { publishedUrl: res.publishedUrl } };
      }

      case "schema_deploy": {
        const platform = asString(payload.platform) || "wordpress";
        const snippet = asString(payload.snippet) || asString(payload.schema);
        if (!snippet) return { ok: false, error: "payload.snippet (JSON-LD) required" };
        if (platform === "wordpress") {
          const creds = await loadProjectIntegration<CmsCredentials>(supabase, item.project_id, "wordpress");
          const postId = Number(payload.postId);
          if (!creds?.apiKey || !creds.url || !Number.isFinite(postId)) {
            return { ok: false, error: "WordPress creds + payload.postId required", surface: "wordpress" };
          }
          const res = await deploySchemaToWordPress(creds.url, creds.apiKey, postId, snippet);
          return res.success ? { ok: true, surface: "wordpress" } : { ok: false, error: res.error || "schema deploy failed", surface: "wordpress" };
        }
        if (platform === "webflow") {
          const creds = await loadProjectIntegration<CmsCredentials>(supabase, item.project_id, "webflow");
          const collectionId = asString(payload.collectionId) || creds?.collectionId;
          const itemId = asString(payload.itemId);
          if (!creds?.apiKey || !creds.siteId || !collectionId || !itemId) {
            return { ok: false, error: "Webflow creds + collectionId + itemId required", surface: "webflow" };
          }
          const res = await deploySchemaToWebflow(creds.siteId, creds.apiKey, collectionId, itemId, snippet);
          return res.success ? { ok: true, surface: "webflow" } : { ok: false, error: res.error || "schema deploy failed", surface: "webflow" };
        }
        return { ok: false, error: `Unsupported schema platform: ${platform}` };
      }

      case "indexnow":
      case "submit_indexnow":
      case "urls_indexed": {
        const urls = Array.isArray(payload.urls) ? (payload.urls as string[]).filter((u) => typeof u === "string") : [];
        if (!urls.length) return { ok: false, error: "payload.urls required" };
        const domain = await projectDomain(supabase, item.project_id);
        if (!domain) return { ok: false, error: "project domain not found" };
        const submitted = await submitIndexNow(urls, domain);
        return submitted > 0
          ? { ok: true, surface: "search", result: { submitted } }
          : { ok: false, error: "IndexNow not configured (INDEXNOW_KEY) or no URLs accepted", surface: "search" };
      }

      case "gbp_post": {
        const text = asString(payload.summary) || asString(payload.text);
        if (!text) return { ok: false, error: "payload.summary required" };
        const token = (await getValidOAuthToken(supabase, item.project_id, "google_business_profile")) || undefined;
        const { data: conn } = await supabase
          .from("oauth_connections")
          .select("metadata")
          .eq("project_id", item.project_id)
          .eq("provider", "google_business_profile")
          .maybeSingle();
        const meta = (conn?.metadata || {}) as Record<string, string>;
        const accountId = asString(payload.accountId) || meta.account_id;
        const locationId = asString(payload.locationId) || meta.location_id;
        if (!token || !accountId || !locationId) {
          return { ok: false, error: "GBP OAuth + account/location IDs required", surface: "google_business" };
        }
        const res = await createGBPLocalPost(token, accountId, locationId, { summary: text });
        return res.success ? { ok: true, surface: "google_business" } : { ok: false, error: "GBP post failed", surface: "google_business" };
      }

      case "social_post":
      case "social_scheduled": {
        const text = asString(payload.text);
        if (!text) return { ok: false, error: "payload.text required" };
        const provider = asString(payload.provider) || (process.env.AYRSHARE_API_KEY ? "ayrshare" : "buffer");
        if (provider === "ayrshare") {
          const apiKey = asString(payload.apiKey) || process.env.AYRSHARE_API_KEY;
          if (!apiKey) return { ok: false, error: "Ayrshare API key required", surface: "ayrshare" };
          const res = await scheduleViaAyrshare(apiKey, {
            text,
            platforms: (payload.platforms as string[]) || ["linkedin", "x"],
            scheduleDate: asString(payload.scheduleDate),
          });
          return res.success ? { ok: true, surface: "ayrshare" } : { ok: false, error: "Ayrshare schedule failed", surface: "ayrshare" };
        }
        const accessToken = asString(payload.accessToken) || process.env.BUFFER_ACCESS_TOKEN;
        if (!accessToken) return { ok: false, error: "Buffer access token required", surface: "buffer" };
        const res = await scheduleViaBuffer(accessToken, {
          text,
          profileIds: (payload.profileIds as string[]) || [],
          scheduledAt: asString(payload.scheduleDate),
        });
        return res.success ? { ok: true, surface: "buffer", result: { updateId: res.updateId } } : { ok: false, error: "Buffer schedule failed", surface: "buffer" };
      }

      case "llms_txt":
      case "llms_txt_deploy": {
        // Deploy llms.txt to the CMS (best-effort) and always return the content
        // so it can be placed at the site root /llms.txt.
        const { data: proj } = await supabase.from("projects").select("name, domain").eq("id", item.project_id).single();
        if (!proj) return { ok: false, error: "project not found" };
        const content =
          asString(payload.content) ||
          buildLlmsTxt({
            brandName: proj.name,
            domain: proj.domain,
            description: asString(payload.description),
            keyPages: Array.isArray(payload.keyPages) ? (payload.keyPages as LlmsKeyPage[]) : undefined,
          });
        const creds = await loadProjectIntegration<CmsCredentials>(supabase, item.project_id, "wordpress");
        if (creds?.apiKey) {
          const res = await publishViaCms("wordpress", creds, { title: "llms.txt", content: `<pre>${content}</pre>` });
          if (res.ok) return { ok: true, publishedUrl: res.publishedUrl, surface: "wordpress", result: { llms_txt: content } };
        }
        // No CMS: still a success — we generated deployable content for root placement.
        return { ok: true, surface: "generated", result: { llms_txt: content, note: "Place at https://" + proj.domain + "/llms.txt" } };
      }

      case "directory_submit": {
        const submitEmail = asString(payload.submitEmail);
        const name = asString(payload.name);
        const description = asString(payload.description);
        if (!submitEmail) return { ok: false, error: "Directory submission requires payload.submitEmail (or do it manually)", surface: "directory" };
        const res = await sendEmail({
          to: submitEmail,
          subject: `Listing submission: ${name || "business"}`,
          html: `<p>Please consider listing the following business:</p><p><strong>${name}</strong></p><p>${description || ""}</p>`,
        });
        return res.sent ? { ok: true, surface: "directory" } : { ok: false, error: "Directory email not sent (configure SMTP)", surface: "directory" };
      }

      case "review_request": {
        const to = asString(payload.to);
        const reviewUrl = asString(payload.reviewUrl);
        if (!to || !reviewUrl) return { ok: false, error: "payload.to and payload.reviewUrl required", surface: "review" };
        const { data: proj } = await supabase.from("projects").select("name").eq("id", item.project_id).single();
        const msg = buildReviewRequest({
          brandName: proj?.name || "our team",
          customerName: asString(payload.customerName),
          reviewUrl,
          platform: asString(payload.platform),
        });
        const res = await sendEmail({ to, subject: msg.subject, html: msg.html });
        return res.sent ? { ok: true, surface: "review" } : { ok: false, error: "Review email not sent (configure SMTP)", surface: "review" };
      }

      case "outreach_send": {
        const to = asString(payload.to);
        const targetSite = asString(payload.targetSite);
        if (!to || !targetSite) return { ok: false, error: "payload.to and payload.targetSite required", surface: "outreach" };
        const { data: proj } = await supabase.from("projects").select("name").eq("id", item.project_id).single();
        const msg = buildOutreachEmail({
          brandName: proj?.name || "our team",
          targetSite,
          contactName: asString(payload.contactName),
          pitchAngle: asString(payload.pitchAngle),
          evidenceUrl: asString(payload.evidenceUrl),
        });
        const res = await sendEmail({ to, subject: msg.subject, html: msg.html });
        return res.sent ? { ok: true, surface: "outreach" } : { ok: false, error: "Outreach email not sent (configure SMTP)", surface: "outreach" };
      }

      default:
        return { ok: false, error: `No runner for action_type "${type}"` };
    }
  } catch (error) {
    // A thrown error here is unexpected (not a clean "not configured" path) —
    // capture it to APM so an operator can react, while still degrading the
    // action to a clean failure result (never a crash or a false success).
    captureException("ops.execute", error, { opsId: item.id, action_type: type });
    return { ok: false, error: error instanceof Error ? error.message : "execution error" };
  }
}

/**
 * Execute a queued ops item end-to-end: run it, persist the result on the row,
 * and record a results-ledger entry. Returns the execution result. Idempotent
 * enough for retries: re-running a completed item just re-attempts the action.
 */
export async function runQueuedOps(supabase: SupabaseClient, opsId: string): Promise<OpsExecutionResult> {
  const { data: item } = await supabase
    .from("ops_queue")
    .select("id, project_id, organization_id, action_type, title, payload, task_id, attempts, status, result, published_url")
    .eq("id", opsId)
    .single();
  if (!item) return { ok: false, error: "ops item not found" };

  // Idempotency guard: a completed item must never be re-executed. Inngest
  // retries and double-clicks would otherwise re-publish content, re-post to
  // GBP/social, or re-send outreach. Return the recorded result instead.
  if (item.status === "completed") {
    return {
      ok: true,
      publishedUrl: item.published_url ?? undefined,
      result: (item.result as Record<string, unknown>) ?? undefined,
    };
  }

  await supabase
    .from("ops_queue")
    .update({ status: "executing", attempts: (item.attempts ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", opsId);

  const result = await executeOpsItem(supabase, item as OpsItem);

  // Projected business impact (Q4) — attached to every completed action so the
  // proof chain carries a forward-looking value, not just an execution log.
  const payload = (item.payload || {}) as Record<string, unknown>;
  const impact = result.ok
    ? estimateActionImpact({
        actionType: item.action_type,
        influence: typeof payload.influence === "number" ? payload.influence : undefined,
        keywordVolume: typeof payload.keywordVolume === "number" ? payload.keywordVolume : undefined,
        cpc: typeof payload.cpc === "number" ? payload.cpc : undefined,
        difficulty: typeof payload.difficulty === "number" ? payload.difficulty : undefined,
      })
    : null;

  await supabase
    .from("ops_queue")
    .update({
      status: result.ok ? "completed" : "failed",
      executed_at: result.ok ? new Date().toISOString() : null,
      published_url: result.publishedUrl ?? null,
      result: { ...((result.result as Record<string, unknown>) ?? {}), impact_estimate: impact ?? undefined },
      error: result.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opsId);

  await recordLedgerAction(supabase, {
    project_id: item.project_id,
    task_id: item.task_id ?? undefined,
    action_type: item.action_type,
    action_surface: result.surface,
    description: result.ok ? `Ops executed: ${item.title}` : `Ops failed: ${item.title} — ${result.error}`,
    status: result.ok ? "completed" : "failed",
    outcome_snapshot: { ...(result.result || {}), publishedUrl: result.publishedUrl, error: result.error },
    delta_summary: impact ? { impact_estimate: impact } : undefined,
  }).catch(() => undefined);

  // Deploy → rescan coupling (Q3): a live published URL triggers an
  // asset-scoped re-probe so the lift is attributed to THIS deployment.
  if (result.ok && result.publishedUrl) {
    const payload = (item.payload || {}) as Record<string, unknown>;
    const keyword =
      (typeof payload.keyword === "string" && payload.keyword) ||
      (typeof payload.title === "string" && payload.title) ||
      undefined;
    await inngest
      .send({
        name: "asset/deployed",
        data: {
          projectId: item.project_id,
          organizationId: item.organization_id,
          url: result.publishedUrl,
          assetId: typeof payload.assetId === "string" ? payload.assetId : undefined,
          keyword,
          taskId: item.task_id ?? undefined,
        },
      })
      .catch(() => undefined);
  }

  return result;
}
