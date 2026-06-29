/**
 * Capability runners (Phase 24.1) — wire the remaining executable ports into the
 * unified provider router so `crawl` and `backlinks` route sovereign-first with
 * auto-failover, exactly like `serp` (serp-router) and `generate`
 * (generate-router) already do.
 *
 * Sovereign engines (keyless fetch crawler, Common Crawl webgraph) are tried
 * before any paid adapter; in Zero-Paid-Keys mode the paid adapters are dropped
 * by the router. Nothing is faked — a missing index degrades to
 * `success:false`.
 */
import type { ProviderResult, CrawlResult } from "./types";
import { route, attachRunner, type RouteOutcome } from "./router";
import { scrapePageKeyless, scrapePageFirecrawl } from "./firecrawl";
import { getBacklinksFree, type BacklinkItem } from "./backlinks-free";
import { getBacklinks } from "./dataforseo";
import { enrichVisitorFromIp, type VisitorEnrichment } from "@/lib/engines/visitor-identity";
import { sendEmail, type EmailMessage, type EmailSendResult } from "@/lib/email/transport";
import { broadcastDirectSocial, type DirectPostResult } from "./social/direct";

let wired = false;
function ensureWired(): void {
  if (wired) return;

  // Crawl port: keyless self-hosted fetch crawler is the sovereign default;
  // Firecrawl is the optional paid upgrade.
  attachRunner<[string], CrawlResult>("crawl", "playwright-crawl", (url) => scrapePageKeyless(url));
  attachRunner<[string], CrawlResult>("crawl", "firecrawl-crawl", (url) => scrapePageFirecrawl(url));

  // Backlinks port: Common Crawl webgraph (keyless) first; DataForSEO optional.
  attachRunner<[string, number], BacklinkItem[]>(
    "backlinks",
    "commoncrawl-webgraph",
    (domain, limit) => getBacklinksFree(domain, limit)
  );
  attachRunner<[string, number], Array<{ url: string; domain: string; rank: number }>>(
    "backlinks",
    "dataforseo-backlinks",
    (domain, limit) => getBacklinks(domain, limit)
  );

  // Enrich port: free IP->ASN/org lookup (sovereign-first inside the engine).
  attachRunner<[string], VisitorEnrichment>("enrich", "ip-asn-enrich", async (ip) => {
    const r = await enrichVisitorFromIp(ip);
    return r.enriched
      ? { success: true, data: r, creditsUsed: 0 }
      : { success: false, error: "no enrichment available" };
  });

  // Email port: self-hosted SMTP first, Resend optional (decided inside sendEmail).
  attachRunner<[EmailMessage], EmailSendResult>("email", "smtp-email", async (msg) => {
    const r = await sendEmail(msg);
    return r.sent ? { success: true, data: r, creditsUsed: 0 } : { success: false, error: r.reason || "email not sent" };
  });

  // Social port: direct X/LinkedIn posting (no Buffer/Ayrshare middleman).
  attachRunner<[string], DirectPostResult[]>("social", "direct-social", async (text) => {
    const results = await broadcastDirectSocial(text);
    return results.some((p) => p.success)
      ? { success: true, data: results, creditsUsed: 0 }
      : { success: false, error: results.map((p) => p.error).filter(Boolean).join("; ") || "no social platform posted" };
  });

  wired = true;
}

/** Best-effort, sovereign-first visitor enrichment through the enrich port. */
export function enrichVisitor(ip: string): Promise<RouteOutcome<VisitorEnrichment>> {
  ensureWired();
  return route<[string], VisitorEnrichment>("enrich", ip);
}

/** Crawl a single page through the sovereign-first crawl port. */
export function crawlContent(url: string): Promise<RouteOutcome<CrawlResult>> {
  ensureWired();
  return route<[string], CrawlResult>("crawl", url);
}

/** Fetch referring domains through the sovereign-first backlinks port. */
export function fetchBacklinks(domain: string, limit = 50): Promise<RouteOutcome<BacklinkItem[]>> {
  ensureWired();
  return route<[string, number], BacklinkItem[]>("backlinks", domain, limit);
}

export type { CrawlResult, BacklinkItem, ProviderResult };
