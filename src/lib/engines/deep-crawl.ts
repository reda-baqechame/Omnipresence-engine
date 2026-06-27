import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPublicDomain } from "@/lib/security/domain";
import { isCrawlAllowed } from "@/lib/crawl/robots-guard";
import { logProviderError } from "@/lib/observability/log";

/**
 * Deep technical crawl (Screaming-Frog-class), Phase 4. A keyless, same-domain
 * BFS that captures the signals a technical SEO actually audits: status codes,
 * redirect chains, duplicate/missing titles + H1s, meta descriptions, canonical
 * tags, noindex, word count, click-depth, internal/external links, and broken
 * internal links. Aggregated into prioritized issues + execution tasks.
 *
 * Runs in-process with no API cost; respects robots.txt. On Railway it can crawl
 * deeper (always-on); on Vercel it stays within request limits via `maxPages`.
 */

export interface DeepCrawlPage {
  url: string;
  status: number;
  depth: number;
  title?: string;
  titleLength: number;
  metaDescription?: string;
  metaLength: number;
  h1s: string[];
  canonical?: string;
  noindex: boolean;
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  redirectChain: string[];
}

export interface CrawlIssue {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  urls: string[];
}

export interface DeepCrawlResult {
  available: boolean;
  reason?: string;
  data_source: "measured" | "unavailable";
  pagesCrawled: number;
  maxDepth: number;
  issues: CrawlIssue[];
  pages: DeepCrawlPage[];
  last_checked_at?: string;
}

interface FetchedPage {
  status: number;
  finalUrl: string;
  redirectChain: string[];
  html: string;
}

const MAX_REDIRECTS = 5;

async function fetchWithChain(url: string): Promise<FetchedPage> {
  const chain: string[] = [];
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(current, {
      headers: { "User-Agent": "PresenceOS-DeepCrawl/1.0" },
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { status: res.status, finalUrl: current, redirectChain: chain, html: "" };
      const next = new URL(loc, current).toString();
      chain.push(next);
      current = next;
      continue;
    }
    const html = res.status === 200 ? await res.text() : "";
    return { status: res.status, finalUrl: current, redirectChain: chain, html };
  }
  return { status: 310, finalUrl: current, redirectChain: chain, html: "" };
}

function parsePage(url: string, fetched: FetchedPage, depth: number, domain: string): DeepCrawlPage {
  const html = fetched.html;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  const metaDescription = html
    .match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?.trim();
  const canonical = html
    .match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)?.[1]
    ?.trim();
  const noindex = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  ).filter(Boolean);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wordCount = text ? (text.match(/\S+/g) || []).length : 0;

  let internal = 0;
  let external = 0;
  for (const m of html.matchAll(/<a[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    try {
      const h = new URL(href, url).hostname.replace(/^www\./, "");
      if (h === domain || h.endsWith(`.${domain}`)) internal++;
      else external++;
    } catch {
      // ignore
    }
  }

  return {
    url,
    status: fetched.status,
    depth,
    title,
    titleLength: title?.length ?? 0,
    metaDescription,
    metaLength: metaDescription?.length ?? 0,
    h1s,
    canonical,
    noindex,
    wordCount,
    internalLinks: internal,
    externalLinks: external,
    redirectChain: fetched.redirectChain,
  };
}

function extractInternalLinks(html: string, base: string, domain: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    try {
      const abs = new URL(href, base);
      if (!["http:", "https:"].includes(abs.protocol)) continue;
      const h = abs.hostname.replace(/^www\./, "");
      if (h !== domain && !h.endsWith(`.${domain}`)) continue;
      abs.hash = "";
      out.push(abs.toString());
    } catch {
      // ignore
    }
  }
  return out;
}

export async function runDeepCrawl(domain: string, maxPages = 60): Promise<DeepCrawlResult> {
  const empty: DeepCrawlResult = {
    available: false,
    data_source: "unavailable",
    pagesCrawled: 0,
    maxDepth: 0,
    issues: [],
    pages: [],
  };
  let cleanDomain: string;
  let start: string;
  try {
    cleanDomain = assertPublicDomain(domain);
    start = `https://${cleanDomain}`;
  } catch (e) {
    return { ...empty, reason: e instanceof Error ? e.message : "Invalid domain" };
  }

  try {
    if (!(await isCrawlAllowed(start, cleanDomain))) {
      return { ...empty, reason: "robots.txt disallows crawling." };
    }
  } catch {
    // proceed; per-URL check still applies
  }

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
  const pages: DeepCrawlPage[] = [];
  const inboundLinks = new Map<string, number>();
  const statusByUrl = new Map<string, number>();
  const linkSources = new Map<string, string[]>(); // target -> source pages

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const norm = url.replace(/#.*$/, "");
    if (visited.has(norm)) continue;
    visited.add(norm);

    try {
      if (!(await isCrawlAllowed(norm, cleanDomain))) continue;
      const fetched = await fetchWithChain(norm);
      statusByUrl.set(norm, fetched.status);
      const page = parsePage(norm, fetched, depth, cleanDomain);
      pages.push(page);

      if (fetched.html && depth < 6) {
        const links = [...new Set(extractInternalLinks(fetched.html, norm, cleanDomain))];
        for (const link of links) {
          inboundLinks.set(link, (inboundLinks.get(link) || 0) + 1);
          const srcs = linkSources.get(link) || [];
          if (srcs.length < 5) srcs.push(norm);
          linkSources.set(link, srcs);
          if (!visited.has(link) && pages.length + queue.length < maxPages * 3) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    } catch (e) {
      logProviderError("deep-crawl:fetch", e, { url: norm });
      pages.push({
        url: norm, status: 0, depth, titleLength: 0, metaLength: 0, h1s: [],
        noindex: false, wordCount: 0, internalLinks: 0, externalLinks: 0, redirectChain: [],
      });
      statusByUrl.set(norm, 0);
    }
  }

  if (pages.length === 0) {
    return { ...empty, reason: "No pages could be crawled." };
  }

  const issues = aggregateIssues(pages, inboundLinks, linkSources);
  const maxDepth = pages.reduce((m, p) => Math.max(m, p.depth), 0);

  return {
    available: true,
    data_source: "measured",
    pagesCrawled: pages.length,
    maxDepth,
    issues,
    pages,
    last_checked_at: new Date().toISOString(),
  };
}

function aggregateIssues(
  pages: DeepCrawlPage[],
  inboundLinks: Map<string, number>,
  linkSources: Map<string, string[]>
): CrawlIssue[] {
  const issues: CrawlIssue[] = [];
  const ok = pages.filter((p) => p.status === 200);

  // Broken internal links: a crawled URL returned 4xx/5xx and is linked-to.
  const broken = pages.filter((p) => (p.status >= 400 || p.status === 0) && (inboundLinks.get(p.url) || 0) > 0);
  if (broken.length) {
    issues.push({
      type: "broken_links",
      severity: "high",
      title: `${broken.length} broken internal link target(s)`,
      detail: "Internal links point to pages returning 4xx/5xx. Fix the URLs or update the links.",
      urls: broken.map((p) => `${p.url} (${p.status})`).slice(0, 30),
    });
  }

  // Redirect chains (2+ hops).
  const chains = pages.filter((p) => p.redirectChain.length >= 2);
  if (chains.length) {
    issues.push({
      type: "redirect_chains",
      severity: "medium",
      title: `${chains.length} redirect chain(s)`,
      detail: "Multi-hop redirects waste crawl budget and slow users. Point links to the final URL.",
      urls: chains.map((p) => `${p.url} → ${p.redirectChain.join(" → ")}`).slice(0, 30),
    });
  }

  // Duplicate titles.
  groupBy(ok.filter((p) => p.title), (p) => p.title!.toLowerCase()).forEach((urls, title) => {
    if (urls.length > 1) {
      issues.push({
        type: "duplicate_title",
        severity: "medium",
        title: `Duplicate title across ${urls.length} pages`,
        detail: `"${title.slice(0, 80)}" is used on multiple pages. Make each title unique.`,
        urls: urls.slice(0, 20),
      });
    }
  });

  // Duplicate H1s.
  groupBy(ok.filter((p) => p.h1s[0]), (p) => p.h1s[0].toLowerCase()).forEach((urls, h1) => {
    if (urls.length > 1) {
      issues.push({
        type: "duplicate_h1",
        severity: "low",
        title: `Duplicate H1 across ${urls.length} pages`,
        detail: `"${h1.slice(0, 80)}" repeats as the H1. Differentiate primary headings.`,
        urls: urls.slice(0, 20),
      });
    }
  });

  // Missing / problematic on-page elements.
  pushUrlIssue(issues, ok.filter((p) => !p.title), "missing_title", "high", "Missing <title>", "These indexable pages have no title tag.");
  pushUrlIssue(issues, ok.filter((p) => p.title && (p.titleLength < 15 || p.titleLength > 65)), "title_length", "low", "Title length out of range", "Titles should be ~15-65 chars to avoid truncation.");
  pushUrlIssue(issues, ok.filter((p) => !p.metaDescription), "missing_meta", "medium", "Missing meta description", "Add a compelling 120-160 char description.");
  pushUrlIssue(issues, ok.filter((p) => p.h1s.length === 0), "missing_h1", "medium", "Missing H1", "Each page should have exactly one descriptive H1.");
  pushUrlIssue(issues, ok.filter((p) => p.h1s.length > 1), "multiple_h1", "low", "Multiple H1s", "Use a single H1 per page for clear topical hierarchy.");
  pushUrlIssue(issues, ok.filter((p) => p.wordCount > 0 && p.wordCount < 200 && !p.noindex), "thin_content", "medium", "Thin content (<200 words)", "Expand these pages with substantive, answer-first content.");
  pushUrlIssue(issues, ok.filter((p) => p.noindex), "noindex", "low", "noindex pages", "These pages are excluded from search — confirm that is intentional.");

  // Orphans (no inbound internal links, not the homepage) and deep pages.
  const orphans = ok.filter((p) => p.depth > 0 && (inboundLinks.get(p.url) || 0) === 0);
  void linkSources;
  if (orphans.length) {
    issues.push({
      type: "orphan_pages",
      severity: "medium",
      title: `${orphans.length} orphan page(s)`,
      detail: "Pages with no inbound internal links can't pass authority. Add contextual links.",
      urls: orphans.map((p) => p.url).slice(0, 30),
    });
  }
  const deep = ok.filter((p) => p.depth >= 4);
  if (deep.length) {
    issues.push({
      type: "deep_pages",
      severity: "low",
      title: `${deep.length} page(s) ≥4 clicks deep`,
      detail: "Deeply buried pages are crawled less. Flatten the architecture / add hub links.",
      urls: deep.map((p) => `${p.url} (depth ${p.depth})`).slice(0, 30),
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

function groupBy<T>(items: T[], key: (i: T) => string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const it of items) {
    const k = key(it);
    const url = (it as unknown as { url: string }).url;
    const arr = map.get(k) || [];
    arr.push(url);
    map.set(k, arr);
  }
  return map;
}

function pushUrlIssue(
  issues: CrawlIssue[],
  matched: DeepCrawlPage[],
  type: string,
  severity: CrawlIssue["severity"],
  title: string,
  detail: string
): void {
  if (matched.length === 0) return;
  issues.push({ type, severity, title: `${matched.length}× ${title}`, detail, urls: matched.map((p) => p.url).slice(0, 30) });
}

/** Persist crawl results and materialize execution tasks for actionable issues. */
export async function persistDeepCrawl(
  supabase: SupabaseClient,
  projectId: string,
  organizationId: string,
  result: DeepCrawlResult
): Promise<void> {
  if (!result.available) return;

  // Guarded replace: only wipe prior rows when we have fresh data.
  if (result.pages.length) {
    await supabase.from("crawl_pages").delete().eq("project_id", projectId);
    await supabase.from("crawl_pages").insert(
      result.pages.slice(0, 500).map((p) => ({
        project_id: projectId,
        url: p.url,
        status: p.status,
        depth: p.depth,
        title: p.title ?? null,
        meta_description: p.metaDescription ?? null,
        h1_count: p.h1s.length,
        canonical: p.canonical ?? null,
        noindex: p.noindex,
        word_count: p.wordCount,
        internal_links: p.internalLinks,
        external_links: p.externalLinks,
        redirect_hops: p.redirectChain.length,
        data_source: "measured",
      }))
    );
  }

  if (result.issues.length) {
    await supabase.from("crawl_issues").delete().eq("project_id", projectId);
    await supabase.from("crawl_issues").insert(
      result.issues.map((i) => ({
        project_id: projectId,
        type: i.type,
        severity: i.severity,
        title: i.title,
        detail: i.detail,
        urls: i.urls,
        data_source: "measured",
      }))
    );
  }

  // Tasks for high/critical issues (dedup on type).
  const { data: existing } = await supabase
    .from("execution_tasks")
    .select("source_id")
    .eq("project_id", projectId)
    .eq("source_module", "deep_crawl");
  const existingIds = new Set((existing || []).map((e) => e.source_id));
  const taskRows = result.issues
    .filter((i) => i.severity === "high" || i.severity === "critical")
    .filter((i) => !existingIds.has(i.type))
    .map((i) => ({
      project_id: projectId,
      organization_id: organizationId,
      title: `Fix: ${i.title}`,
      description: i.detail,
      source_module: "deep_crawl" as const,
      source_id: i.type,
      category: "technical",
      priority: i.severity === "critical" ? "critical" : "high",
      impact: i.severity === "critical" ? 80 : 60,
      effort: 3,
      status: "todo" as const,
    }));
  if (taskRows.length) {
    await supabase.from("execution_tasks").insert(taskRows);
  }
}
