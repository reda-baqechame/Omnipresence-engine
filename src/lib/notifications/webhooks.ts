import { createHmac } from "crypto";

// Self-contained (no `@/` alias imports) so signing logic runs under `node --test`.
function logProviderError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[provider-error] ${JSON.stringify({ level: "warn", scope, message, ...context })}`);
}

/**
 * Outbound webhook delivery (Wave T3 agency polish).
 *
 * Lets agencies/integrators receive signed events (scan completed, deploy
 * verified, guarantee status changed, fastest-path updated) at their own URLs.
 * Each delivery is HMAC-SHA256 signed so the receiver can verify authenticity.
 * Fire-and-forget + fail-safe: a slow/broken receiver never blocks the product.
 */

export type WebhookEvent =
  | "scan.completed"
  | "deploy.verified"
  | "guarantee.updated"
  | "fastest_path.updated"
  | "attribution.synced";

export interface WebhookEndpoint {
  url: string;
  /** Shared secret used to sign the payload (per endpoint). */
  secret?: string;
}

export interface WebhookDelivery {
  event: WebhookEvent;
  projectId?: string;
  data: Record<string, unknown>;
}

/** Compute the signature header value: sha256=<hex hmac of the raw body>. */
export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Deliver one event to one endpoint. Returns whether the POST succeeded; never
 * throws. Includes a timestamp + signature header for replay/forgery protection.
 */
export async function deliverWebhook(
  endpoint: WebhookEndpoint,
  delivery: WebhookDelivery
): Promise<{ ok: boolean; status?: number }> {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    event: delivery.event,
    project_id: delivery.projectId,
    timestamp,
    data: delivery.data,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "PresenceOS-Webhooks/1.0",
    "X-PresenceOS-Event": delivery.event,
    "X-PresenceOS-Timestamp": timestamp,
  };
  if (endpoint.secret) {
    headers["X-PresenceOS-Signature"] = signWebhookBody(body, endpoint.secret);
  }

  try {
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logProviderError("webhook.deliver", new Error(`status ${res.status}`), {
        url: endpoint.url,
        event: delivery.event,
      });
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    logProviderError("webhook.deliver", e, { url: endpoint.url, event: delivery.event });
    return { ok: false };
  }
}

/**
 * Resolve the webhook endpoints to notify: a global env list
 * (OUTBOUND_WEBHOOK_URLS, comma-separated) plus optional per-call endpoints.
 * The global signing secret is OUTBOUND_WEBHOOK_SECRET.
 */
export function resolveEndpoints(extra: WebhookEndpoint[] = []): WebhookEndpoint[] {
  const secret = process.env.OUTBOUND_WEBHOOK_SECRET;
  const envUrls = (process.env.OUTBOUND_WEBHOOK_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url) => ({ url, secret }));
  return [...envUrls, ...extra];
}

/**
 * Fan a single event out to all resolved endpoints concurrently. Best-effort;
 * returns the per-endpoint results. Safe to call without awaiting.
 */
export async function emitWebhookEvent(
  delivery: WebhookDelivery,
  extraEndpoints: WebhookEndpoint[] = []
): Promise<{ delivered: number; total: number }> {
  const endpoints = resolveEndpoints(extraEndpoints);
  if (endpoints.length === 0) return { delivered: 0, total: 0 };
  const results = await Promise.all(endpoints.map((e) => deliverWebhook(e, delivery)));
  return { delivered: results.filter((r) => r.ok).length, total: endpoints.length };
}
