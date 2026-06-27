import robotsParser from "robots-parser";
import { scrapePage } from "@/lib/providers/firecrawl";
import { AI_BOTS } from "@/lib/providers/ai-gateway";
import { runSiteCrawl, crawlFindingsToTechnical } from "@/lib/engines/site-crawler";
import { getPageSpeed } from "@/lib/providers/pagespeed";
import { runQualityAudit } from "@/lib/engines/quality-audit";
import type { FindingSeverity } from "@/types/database";

export interface TechnicalAuditFinding {
  category: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  impact?: string;
  fix_recommendation?: string;
  affected_url?: string;
}

export async function runTechnicalAudit(
  domain: string
): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;

  // Robots.txt check
  const robotsFindings = await checkRobotsTxt(baseUrl);
  findings.push(...robotsFindings);

  // Sitemap check
  const sitemapFindings = await checkSitemap(baseUrl);
  findings.push(...sitemapFindings);

  // Homepage audit
  const homepageResult = await scrapePage(baseUrl);
  if (homepageResult.success && homepageResult.data) {
    const page = homepageResult.data;
    findings.push(...auditPage(page));

    // Schema check
    findings.push(...checkSchema(page.schemaTypes, baseUrl));

    // Meta check
    findings.push(...checkMeta(page.title, page.metaDescription, baseUrl));

    // JS-render dependency (most AI crawlers do NOT execute JavaScript)
    findings.push(...await checkJsRendering(baseUrl, page.wordCount));
  } else {
    findings.push({
      category: "crawlability",
      severity: "critical",
      title: "Website unreachable",
      description: `Could not access ${baseUrl}. The site may be down or blocking crawlers.`,
      impact: "Search engines and AI bots cannot index your content.",
      fix_recommendation: "Ensure your website is publicly accessible and returns HTTP 200.",
      affected_url: baseUrl,
    });
  }

  // AI bot access check
  findings.push(...await checkAIBotAccess(baseUrl));

  // Apple Business Connect (manual — no public lookup API)
  findings.push(appleBusinessConnectStatus(baseUrl));

  // Core Web Vitals / page speed (retrieval timeout risk for AI engines)
  findings.push(...await checkPageSpeed(baseUrl));

  // Accessibility (WCAG heuristics), HTML validity (W3C), Rich Results eligibility — all keyless.
  try {
    const quality = await runQualityAudit(baseUrl);
    if (quality.available) findings.push(...quality.findings);
  } catch {
    // Quality audit is best-effort; never block the core audit.
  }

  // Multi-page crawl (PageRank + SimHash dedupe)
  try {
    const crawl = await runSiteCrawl(domain, 25);
    findings.push(...crawlFindingsToTechnical(crawl));
  } catch {
    // Crawl optional when domain blocked or unreachable
  }

  return findings;
}

async function checkRobotsTxt(baseUrl: string): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  const robotsUrl = new URL("/robots.txt", baseUrl).toString();

  try {
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "PresenceOS-Audit/1.0" },
    });

    if (!response.ok) {
      findings.push({
        category: "robots",
        severity: "medium",
        title: "No robots.txt found",
        description: "Your site does not have a robots.txt file.",
        impact: "Crawlers have no explicit guidance on what to crawl.",
        fix_recommendation: "Create a robots.txt file at your domain root allowing important bots.",
        affected_url: robotsUrl,
      });
      return findings;
    }

    const robotsTxt = await response.text();
    const robots = robotsParser(robotsUrl, robotsTxt);

    if (!robots.isAllowed(baseUrl, "*")) {
      findings.push({
        category: "robots",
        severity: "critical",
        title: "Site blocked in robots.txt",
        description: "Your robots.txt blocks all crawlers from accessing your site.",
        impact: "No search engine or AI bot can index your content.",
        fix_recommendation: "Remove or modify the Disallow: / rule in robots.txt.",
        affected_url: robotsUrl,
      });
    }

    for (const bot of AI_BOTS) {
      if (!robots.isAllowed(baseUrl, bot)) {
        findings.push({
          category: "ai_bot_access",
          severity: "high",
          title: `${bot} blocked in robots.txt`,
          description: `Your robots.txt blocks ${bot} from crawling your site.`,
          impact: `Your content may not appear in AI answers powered by ${bot}.`,
          fix_recommendation: `Add a User-agent: ${bot} section allowing access, or remove the Disallow rule for this bot.`,
          affected_url: robotsUrl,
        });
      }
    }
  } catch {
    findings.push({
      category: "robots",
      severity: "low",
      title: "Could not fetch robots.txt",
      description: "Unable to retrieve robots.txt for analysis.",
      affected_url: robotsUrl,
    });
  }

  return findings;
}

async function checkSitemap(baseUrl: string): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  const sitemapUrls = [
    new URL("/sitemap.xml", baseUrl).toString(),
    new URL("/sitemap_index.xml", baseUrl).toString(),
  ];

  let found = false;
  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await fetch(sitemapUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "PresenceOS-Audit/1.0" },
      });
      if (response.ok) {
        found = true;
        const text = await response.text();
        const urlCount = (text.match(/<loc>/g) || []).length;
        if (urlCount === 0) {
          findings.push({
            category: "sitemap",
            severity: "high",
            title: "Empty sitemap",
            description: "Your sitemap exists but contains no URLs.",
            impact: "Search engines may not discover your pages efficiently.",
            fix_recommendation: "Populate your sitemap with all important pages.",
            affected_url: sitemapUrl,
          });
        }
        break;
      }
    } catch {
      // Try next URL
    }
  }

  if (!found) {
    findings.push({
      category: "sitemap",
      severity: "high",
      title: "No sitemap found",
      description: "No sitemap.xml or sitemap_index.xml detected.",
      impact: "Search engines may miss pages during crawling.",
      fix_recommendation: "Create and submit a sitemap.xml with all important URLs.",
      affected_url: new URL("/sitemap.xml", baseUrl).toString(),
    });
  }

  return findings;
}

function auditPage(page: import("@/lib/providers/types").CrawlResult): TechnicalAuditFinding[] {
  const findings: TechnicalAuditFinding[] = [];

  if (page.hasNoindex) {
    findings.push({
      category: "indexability",
      severity: "critical",
      title: "Page has noindex directive",
      description: "This page tells search engines not to index it.",
      impact: "Page will not appear in search results or AI answers.",
      fix_recommendation: "Remove the noindex meta tag or X-Robots-Tag header.",
      affected_url: page.url,
    });
  }

  if (page.statusCode >= 400) {
    findings.push({
      category: "indexability",
      severity: "critical",
      title: `HTTP ${page.statusCode} error`,
      description: `Page returns HTTP ${page.statusCode}.`,
      impact: "Search engines cannot index error pages.",
      fix_recommendation: "Fix the server error or redirect to a valid page.",
      affected_url: page.url,
    });
  }

  const imagesWithoutAlt = page.images.filter((img) => !img.alt || img.alt.trim() === "");
  if (imagesWithoutAlt.length > 0) {
    findings.push({
      category: "on_page",
      severity: "medium",
      title: `${imagesWithoutAlt.length} images missing alt text`,
      description: "Images without alt text hurt accessibility and SEO.",
      impact: "Reduced image search visibility and accessibility score.",
      fix_recommendation: "Add descriptive alt text to all images.",
      affected_url: page.url,
    });
  }

  if (page.wordCount < 300) {
    findings.push({
      category: "content",
      severity: "medium",
      title: "Thin content detected",
      description: `Page has only ${page.wordCount} words.`,
      impact: "Thin pages are less likely to rank or be cited by AI.",
      fix_recommendation: "Add comprehensive, useful content (aim for 800+ words on key pages).",
      affected_url: page.url,
    });
  }

  if (page.internalLinks.length < 3) {
    findings.push({
      category: "internal_linking",
      severity: "medium",
      title: "Low internal link count",
      description: `Only ${page.internalLinks.length} internal links found.`,
      impact: "Poor internal linking reduces page authority distribution.",
      fix_recommendation: "Add relevant internal links to related pages.",
      affected_url: page.url,
    });
  }

  return findings;
}

function checkSchema(schemaTypes: string[], url: string): TechnicalAuditFinding[] {
  const findings: TechnicalAuditFinding[] = [];
  const recommendedTypes = ["Organization", "LocalBusiness", "WebSite", "FAQPage", "Product", "Service"];

  if (schemaTypes.length === 0) {
    findings.push({
      category: "schema",
      severity: "high",
      title: "No structured data found",
      description: "No JSON-LD schema markup detected on this page.",
      impact: "AI systems and search engines have less structured context about your business.",
      fix_recommendation: "Add Organization and relevant schema types (FAQ, Product, LocalBusiness) using JSON-LD.",
      affected_url: url,
    });
  } else {
    const missing = recommendedTypes.filter((t) => !schemaTypes.includes(t));
    if (missing.length > 0) {
      findings.push({
        category: "schema",
        severity: "medium",
        title: `Missing recommended schema types`,
        description: `Found: ${schemaTypes.join(", ")}. Missing: ${missing.join(", ")}.`,
        impact: "Additional schema types help AI understand your business better.",
        fix_recommendation: `Add ${missing.slice(0, 2).join(" and ")} schema markup.`,
        affected_url: url,
      });
    }
  }

  return findings;
}

function checkMeta(
  title?: string,
  metaDescription?: string,
  url?: string
): TechnicalAuditFinding[] {
  const findings: TechnicalAuditFinding[] = [];

  if (!title || title.trim() === "") {
    findings.push({
      category: "on_page",
      severity: "high",
      title: "Missing title tag",
      description: "Page has no title tag.",
      impact: "Search engines and AI use titles as primary page identifiers.",
      fix_recommendation: "Add a descriptive, keyword-rich title tag (50-60 characters).",
      affected_url: url,
    });
  } else if (title.length > 60) {
    findings.push({
      category: "on_page",
      severity: "low",
      title: "Title tag too long",
      description: `Title is ${title.length} characters (recommended: 50-60).`,
      fix_recommendation: "Shorten the title to under 60 characters.",
      affected_url: url,
    });
  }

  if (!metaDescription || metaDescription.trim() === "") {
    findings.push({
      category: "on_page",
      severity: "medium",
      title: "Missing meta description",
      description: "Page has no meta description.",
      impact: "Search snippets and AI summaries may be less compelling.",
      fix_recommendation: "Add a compelling meta description (150-160 characters).",
      affected_url: url,
    });
  }

  return findings;
}

async function checkPageSpeed(baseUrl: string): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  const ps = await getPageSpeed(baseUrl, "mobile");
  if (!ps.success || !ps.data) return findings;

  const { performanceScore, lcpMs, cls, tbtMs } = ps.data;

  if (performanceScore < 50) {
    findings.push({
      category: "performance",
      severity: "high",
      title: `Slow page speed (Lighthouse ${performanceScore}/100)`,
      description: "Slow pages frequently time out during AI engine retrieval (Perplexity, AI Overviews).",
      impact: "Pages that fail to load fast are dropped from the AI retrieval candidate set.",
      fix_recommendation: "Optimize images, reduce JavaScript, and enable caching/CDN to raise the score above 70.",
      affected_url: baseUrl,
    });
  } else if (performanceScore < 70) {
    findings.push({
      category: "performance",
      severity: "medium",
      title: `Moderate page speed (Lighthouse ${performanceScore}/100)`,
      description: "Page speed is below the threshold that AI retrievers reliably tolerate.",
      impact: "Slower retrieval reduces citation eligibility for grounded AI engines.",
      fix_recommendation: "Target a Lighthouse performance score of 70+ for consistent AI retrieval.",
      affected_url: baseUrl,
    });
  }

  if (lcpMs > 4000) {
    findings.push({
      category: "performance",
      severity: "medium",
      title: `Poor Largest Contentful Paint (${(lcpMs / 1000).toFixed(1)}s)`,
      description: `LCP of ${(lcpMs / 1000).toFixed(1)}s exceeds the 2.5s "good" threshold.`,
      impact: "High LCP signals slow loading that can break AI crawler retrieval.",
      fix_recommendation: "Preload the hero image/font and reduce render-blocking resources.",
      affected_url: baseUrl,
    });
  }

  if (cls > 0.25) {
    findings.push({
      category: "performance",
      severity: "low",
      title: `Layout instability (CLS ${cls})`,
      description: `Cumulative Layout Shift of ${cls} exceeds the 0.1 "good" threshold.`,
      impact: "Unstable layouts degrade UX and Core Web Vitals.",
      fix_recommendation: "Reserve space for images/ads and avoid late-injected content.",
      affected_url: baseUrl,
    });
  }

  if (tbtMs > 600) {
    findings.push({
      category: "performance",
      severity: "low",
      title: `High Total Blocking Time (${tbtMs}ms)`,
      description: "Heavy main-thread work delays interactivity and crawler parsing.",
      impact: "Excessive JS blocks fast retrieval and rendering.",
      fix_recommendation: "Split bundles, defer non-critical JS, and remove unused scripts.",
      affected_url: baseUrl,
    });
  }

  return findings;
}

/** Strip HTML to approximate visible text word count. */
function htmlToWordCount(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(" ").filter(Boolean).length;
}

/**
 * Detect JS-dependent rendering: most AI crawlers (GPTBot, ClaudeBot,
 * PerplexityBot) do NOT execute JavaScript. If the raw HTML is nearly empty but
 * the rendered page is content-rich, that content is invisible to AI engines.
 */
async function checkJsRendering(
  baseUrl: string,
  renderedWordCount: number
): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  if (renderedWordCount < 50) return findings; // nothing meaningful to compare
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "PresenceOS-Audit/1.0" },
    });
    if (!res.ok) return findings;
    const html = await res.text();
    const rawWords = htmlToWordCount(html);
    const ratio = rawWords / Math.max(renderedWordCount, 1);

    if (ratio < 0.3) {
      findings.push({
        category: "crawlability",
        severity: "high",
        title: "Content requires JavaScript to render",
        description: `Raw HTML exposes only ~${rawWords} words vs ~${renderedWordCount} after rendering. Most AI crawlers do not execute JavaScript.`,
        impact:
          "GPTBot, ClaudeBot, and PerplexityBot likely see an almost-empty page, so your content cannot be cited.",
        fix_recommendation:
          "Server-side render (SSR) or pre-render key content into the initial HTML response.",
        affected_url: baseUrl,
      });
    } else if (ratio < 0.6) {
      findings.push({
        category: "crawlability",
        severity: "medium",
        title: "Partial JavaScript-dependent content",
        description: `Raw HTML contains ~${Math.round(ratio * 100)}% of the rendered text. Some content depends on JavaScript.`,
        impact: "Portions of your content may be invisible to non-JS AI crawlers.",
        fix_recommendation: "Ensure primary content and answers are present in server-rendered HTML.",
        affected_url: baseUrl,
      });
    }
  } catch {
    // Raw fetch failed — skip (covered by unreachable finding elsewhere)
  }
  return findings;
}

function appleBusinessConnectStatus(baseUrl: string): TechnicalAuditFinding {
  return {
    category: "local",
    severity: "low",
    title: "Apple Business Connect not verified",
    description:
      "Apple Business Connect has no public lookup API, so registration must be confirmed manually.",
    impact:
      "Without it, Apple Maps, Siri, and Apple Intelligence cannot reliably surface your business.",
    fix_recommendation:
      "Register and verify your business at businessconnect.apple.com to feed Apple's AI surfaces.",
    affected_url: baseUrl,
  };
}

async function checkAIBotAccess(baseUrl: string): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  // Perplexity-User is the live user-triggered fetcher (distinct from PerplexityBot).
  const criticalBots = ["OAI-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended"];

  for (const bot of criticalBots) {
    try {
      const response = await fetch(baseUrl, {
        headers: { "User-Agent": bot },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });

      if (response.status >= 400) {
        findings.push({
          category: "ai_bot_access",
          severity: "high",
          title: `${bot} receives HTTP ${response.status}`,
          description: `When ${bot} tries to access your site, it gets an error.`,
          impact: `Content may not be available for AI search features using ${bot}.`,
          fix_recommendation: "Ensure your server allows access for AI crawlers.",
          affected_url: baseUrl,
        });
      }
    } catch {
      // Network error — already covered by unreachable finding
    }
  }

  return findings;
}
