import { scrapePage } from "@/lib/providers/firecrawl";
import { runSiteCrawl } from "@/lib/engines/site-crawler";
import { searchGoogleOrganicRouter, getActiveSerpProvider } from "@/lib/providers/serp-router";
import type { CrawlResult } from "@/lib/providers/types";
import type { FindingSeverity } from "@/types/database";
import type { TechnicalAuditFinding } from "./technical-audit";

const QUESTION_RE = /^(how|what|why|when|where|who|is|are|can|does|do|should|which)\b/i;
const STAT_RE = /\d+(\.\d+)?\s*%|\$[\d,]+|\b\d{4}\b|\b\d[\d,]*\s*(x|years?|months?|clients?|customers?|users?|reviews?|hours?|days?|minutes?|seconds?|million|billion|k\b)/gi;

/**
 * Analyze answer-engine passage readiness across the most important pages.
 * Encodes 2026 GEO citation heuristics on real page body content:
 *  - answer-first 40-80 word lead (median AI Overview answer = 67 words)
 *  - 120-180 word self-contained liftable blocks (~70% more ChatGPT citations)
 *  - front-loading: key claims in the first ~30% of text (44% of citations)
 *  - statistical density (pages with ~19+ data points get cited ~2x more)
 *  - outbound primary-source links (+18-25% citation lift)
 *  - freshness + visible current-year signal (+~30% citation lift)
 */
export async function analyzePassageReadiness(
  domain: string
): Promise<TechnicalAuditFinding[]> {
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
  const urls = await selectKeyPages(baseUrl);

  const findings: TechnicalAuditFinding[] = [];
  const pages: CrawlResult[] = [];

  for (const url of urls) {
    const res = await scrapePage(url);
    if (res.success && res.data) {
      pages.push(res.data);
      findings.push(...analyzePage(res.data, url));
    }
  }

  // Aggregate freshness signal across analyzed pages.
  if (pages.length > 0) {
    findings.push(...aggregateFreshness(pages, baseUrl));
  }

  // Per-engine index coverage (only when a SERP provider is configured).
  findings.push(...(await analyzeIndexCoverage(domain)));

  return findings;
}

/** Choose homepage + top internal pages by PageRank for analysis. */
async function selectKeyPages(baseUrl: string): Promise<string[]> {
  const urls = new Set<string>([baseUrl]);
  try {
    const crawl = await runSiteCrawl(baseUrl, 25);
    const ranked = crawl.pages
      .filter((p) => p.status === 200 && p.url)
      .sort((a, b) => b.pagerank - a.pagerank)
      .slice(0, 4)
      .map((p) => p.url);
    for (const u of ranked) urls.add(u);
  } catch {
    // Homepage-only when crawl unavailable.
  }
  return [...urls].slice(0, 5);
}

function analyzePage(data: CrawlResult, url: string): TechnicalAuditFinding[] {
  const findings: TechnicalAuditFinding[] = [];
  const wordCount = data.wordCount || 0;
  const paragraphs = (data.paragraphs || []).filter((p) => p.split(/\s+/).length >= 8);
  const text = data.textContent || paragraphs.join(" ");

  if (wordCount < 500) {
    findings.push({
      category: "passage",
      severity: "medium",
      title: "Content too thin for AI passage extraction",
      description: `Page has ~${wordCount} words. AI engines prefer 500-2000 word dense pages.`,
      impact: "Low retrieval eligibility for complex buyer queries.",
      fix_recommendation: "Expand with direct-answer sections and proprietary data points.",
      affected_url: url,
    });
  }

  // Question-style H2s
  const h2s = data.headings.filter((h) => h.level === 2);
  const questionH2s = h2s.filter((h) => QUESTION_RE.test(h.text));
  if (h2s.length >= 3 && questionH2s.length / h2s.length < 0.3) {
    findings.push({
      category: "passage",
      severity: "medium",
      title: "H2 headings not phrased as buyer questions",
      description: "Most H2s don't match the question phrasing AI retrievers prefer.",
      impact: "Lower match rate for conversational AI queries.",
      fix_recommendation: 'Rewrite H2s as questions: "How much does X cost?" not "Pricing".',
      affected_url: url,
    });
  }

  // Answer-first lead: first substantive paragraph should be 40-80 words
  const firstPara = paragraphs[0];
  if (firstPara) {
    const leadWords = firstPara.split(/\s+/).length;
    if (leadWords > 120) {
      findings.push({
        category: "passage",
        severity: "high",
        title: "No answer-first lead paragraph",
        description: `Opening block is ${leadWords} words; AI lifts 40-80 word direct answers (median AI Overview answer is 67 words).`,
        impact: "Major citation eligibility gap — the answer is buried.",
        fix_recommendation: "Open the page/section with a direct 40-80 word answer, then supporting detail.",
        affected_url: url,
      });
    }
  }

  // Liftable 120-180 word self-contained blocks
  if (paragraphs.length >= 3) {
    const liftable = paragraphs.filter((p) => {
      const w = p.split(/\s+/).length;
      return w >= 120 && w <= 180;
    });
    if (liftable.length === 0) {
      findings.push({
        category: "passage",
        severity: "medium",
        title: "No liftable 120-180 word passages",
        description: "Sections sized 120-180 words earn ~70% more ChatGPT citations.",
        impact: "Blocks are too short or too long to be quoted verbatim.",
        fix_recommendation: "Restructure key sections into self-contained 120-180 word blocks.",
        affected_url: url,
      });
    }
  }

  // Front-loading: statistics should appear in the first 30% of the text
  if (text.length > 600) {
    const firstThird = text.slice(0, Math.floor(text.length * 0.3));
    const statsUpFront = (firstThird.match(STAT_RE) || []).length;
    if (statsUpFront === 0) {
      findings.push({
        category: "passage",
        severity: "medium",
        title: "Key claims not front-loaded",
        description: "44% of AI citations come from the first 30% of a page's text, but no data points appear up front.",
        impact: "Citation selectors skip pages that bury their evidence.",
        fix_recommendation: "Move your strongest stat or claim into the first third of the page.",
        affected_url: url,
      });
    }
  }

  // Statistical density (target ~19+ data points on a substantial page)
  const statCount = (text.match(STAT_RE) || []).length;
  const target = wordCount > 1500 ? 19 : Math.max(5, Math.round(wordCount / 100));
  if (wordCount >= 300 && statCount < target) {
    findings.push({
      category: "passage",
      severity: statCount === 0 ? "high" : "medium",
      title: "Low statistical density",
      description: `Found ~${statCount} data points; pages with 19+ specific stats are cited ~2x more often.`,
      impact: "Generic claims without numbers are skipped by citation selectors.",
      fix_recommendation: "Add sourced stats, dates, prices, and original data points.",
      affected_url: url,
    });
  }

  // Outbound primary-source links
  if (wordCount >= 500 && (data.externalLinks?.length || 0) === 0) {
    findings.push({
      category: "passage",
      severity: "low",
      title: "No outbound primary-source links",
      description: "Pages that cite original studies get cited ~18-25% more themselves.",
      impact: "Missing the credibility signal AI engines reward.",
      fix_recommendation: "Link out to authoritative primary sources for your key claims.",
      affected_url: url,
    });
  }

  return findings;
}

/** Freshness via Article schema dates + visible current-year signal. */
function aggregateFreshness(pages: CrawlResult[], baseUrl: string): TechnicalAuditFinding[] {
  const findings: TechnicalAuditFinding[] = [];
  const currentYear = new Date().getFullYear();
  const yearRe = new RegExp(`\\b${currentYear}\\b`);

  let newest: number | undefined;
  let anyDate = false;
  let currentYearVisible = false;

  for (const page of pages) {
    for (const block of page.schemaJson as Array<Record<string, unknown>>) {
      const modified = block?.["dateModified"] || block?.["datePublished"];
      if (typeof modified === "string") {
        const t = Date.parse(modified);
        if (!Number.isNaN(t)) {
          anyDate = true;
          newest = newest === undefined ? t : Math.max(newest, t);
        }
      }
    }
    const haystack = `${page.title || ""} ${page.headings.map((h) => h.text).join(" ")} ${page.textContent?.slice(0, 1500) || ""}`;
    if (yearRe.test(haystack)) currentYearVisible = true;
  }

  if (anyDate && newest !== undefined) {
    const days = (Date.now() - newest) / (1000 * 60 * 60 * 24);
    if (days > 180) {
      findings.push({
        category: "freshness",
        severity: "high",
        title: "Content appears stale",
        description: `Newest dateModified signal is ~${Math.round(days)} days old.`,
        impact: "Perplexity cites 30-day-old content ~82% of the time; stale pages get dropped.",
        fix_recommendation: "Refresh key pages with new stats and update dateModified.",
        affected_url: baseUrl,
      });
    }
  } else {
    findings.push({
      category: "freshness",
      severity: "low",
      title: "No publish/modified date detected",
      description: "Missing date signals in Article schema and visible content.",
      impact: "AI engines favor content with clear recency signals.",
      fix_recommendation: "Add datePublished and dateModified in Article schema and visible text.",
      affected_url: baseUrl,
    });
  }

  if (!currentYearVisible) {
    findings.push({
      category: "freshness",
      severity: "low",
      title: `No visible ${currentYear} recency signal`,
      description: `Adding the current year ("${currentYear}") to titles/headings improves citation rates ~30%.`,
      impact: "Content reads as potentially outdated to recency-biased AI engines.",
      fix_recommendation: `Reference ${currentYear} data and add the year to key titles where accurate.`,
      affected_url: baseUrl,
    });
  }

  return findings;
}

/** Per-engine index coverage: ChatGPT->Bing, Claude->Brave, Gemini/AIO->Google. */
export async function analyzeIndexCoverage(
  domain: string
): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  const provider = getActiveSerpProvider();

  if (!provider) {
    findings.push({
      category: "index_coverage",
      severity: "low",
      title: "Index coverage not verified (no SERP provider)",
      description: "Configure a SERP provider to verify your pages are in the indexes AI engines read.",
      impact: "ChatGPT reads Bing, Claude reads Brave, Gemini/AI Overviews read Google.",
      fix_recommendation: "Set SERPER_API_KEY or BRAVE_SEARCH_API_KEY, submit sitemaps to Bing Webmaster, and enable IndexNow.",
      affected_url: `https://${domain.replace(/^https?:\/\//, "")}`,
    });
    return findings;
  }

  const clean = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  try {
    const res = await searchGoogleOrganicRouter(`site:${clean}`, "United States", clean, []);
    if (res.success && res.data) {
      const indexed = res.data.brandInResults || res.data.organicResults.length > 0;
      if (!indexed) {
        findings.push({
          category: "index_coverage",
          severity: "high",
          title: `Not found in ${res.provider || provider} index`,
          description: `A site: query returned no pages for ${clean}.`,
          impact: "If you're not indexed, AI engines grounded on that index cannot cite you.",
          fix_recommendation: "Submit your sitemap, fix crawl access, and use IndexNow for fast (re)indexing.",
          affected_url: `https://${clean}`,
        });
      }
    }
  } catch {
    // Non-fatal — index coverage is a best-effort signal.
  }

  if (!process.env.INDEXNOW_KEY) {
    findings.push({
      category: "index_coverage",
      severity: "low",
      title: "IndexNow not enabled",
      description: "IndexNow notifies Bing (and thus ChatGPT retrieval) of new/updated URLs instantly.",
      impact: "Slower discovery delays AI citation of fresh content.",
      fix_recommendation: "Set INDEXNOW_KEY to enable instant indexing on the Distribution tab.",
      affected_url: `https://${clean}`,
    });
  }

  return findings;
}

export function passageReadinessScore(findings: TechnicalAuditFinding[]): number {
  const passage = findings.filter(
    (f) => f.category === "passage" || f.category === "freshness"
  );
  const penalty = passage.reduce((sum, f) => {
    const weights: Record<FindingSeverity, number> = {
      critical: 30,
      high: 20,
      medium: 10,
      low: 5,
      info: 0,
    };
    return sum + weights[f.severity];
  }, 0);
  return Math.max(0, 100 - penalty);
}
