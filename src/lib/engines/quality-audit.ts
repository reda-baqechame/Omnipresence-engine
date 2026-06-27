import * as cheerio from "cheerio";
import { fetchWithTimeout } from "@/lib/providers/http";
import { validateHtml } from "@/lib/providers/w3c-validator";
import type { FindingSeverity } from "@/types/database";

/**
 * Keyless quality audit (Phase 10): WCAG-flavored accessibility heuristics
 * (axe/Pa11y-class checks that don't need a browser), W3C HTML validity, and
 * structured-data Rich Results eligibility — all free, all graceful.
 */

export interface QualityFinding {
  category: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  impact?: string;
  fix_recommendation?: string;
  affected_url?: string;
}

export interface QualityAuditResult {
  available: boolean;
  reason?: string;
  findings: QualityFinding[];
  a11yIssues: number;
  htmlErrors: number;
  richResultsEligible: string[];
}

/** Rich Results required properties per common type (subset, Google guidelines). */
const RICH_RESULT_REQUIREMENTS: Record<string, string[]> = {
  Product: ["name", "image", "offers"],
  FAQPage: ["mainEntity"],
  Article: ["headline", "image", "datePublished"],
  Recipe: ["name", "image", "recipeIngredient"],
  Event: ["name", "startDate", "location"],
  LocalBusiness: ["name", "address"],
  Organization: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
};

export async function runQualityAudit(domain: string): Promise<QualityAuditResult> {
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  let html = "";
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "OmniPresence-Audit/1.0" },
      timeoutMs: 15_000,
    });
    if (!res.ok) {
      return { available: false, reason: `Fetch ${res.status}`, findings: [], a11yIssues: 0, htmlErrors: 0, richResultsEligible: [] };
    }
    html = await res.text();
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : "Fetch failed", findings: [], a11yIssues: 0, htmlErrors: 0, richResultsEligible: [] };
  }

  const findings: QualityFinding[] = [];
  const a11y = auditAccessibility(html, url);
  findings.push(...a11y);

  const rich = checkRichResults(html, url);
  findings.push(...rich.findings);

  // W3C validity (best-effort; remote service may rate-limit).
  let htmlErrors = 0;
  const w3c = await validateHtml(html);
  if (w3c.available) {
    htmlErrors = w3c.errors;
    if (w3c.errors > 0) {
      const top = w3c.messages.filter((m) => m.type === "error").slice(0, 5).map((m) => m.message);
      findings.push({
        category: "html_validity",
        severity: w3c.errors > 20 ? "medium" : "low",
        title: `${w3c.errors} HTML validation error${w3c.errors === 1 ? "" : "s"}`,
        description: `W3C Nu checker found ${w3c.errors} errors and ${w3c.warnings} warnings. Examples: ${top.join(" | ")}`,
        impact: "Invalid HTML can break crawler parsing, rich results, and accessibility tooling.",
        fix_recommendation: "Resolve the W3C validation errors; prioritize unclosed/duplicate elements and invalid attributes.",
        affected_url: url,
      });
    }
  }

  return {
    available: true,
    findings,
    a11yIssues: a11y.length,
    htmlErrors,
    richResultsEligible: rich.eligible,
  };
}

function auditAccessibility(html: string, url: string): QualityFinding[] {
  const $ = cheerio.load(html);
  const findings: QualityFinding[] = [];

  // 1. Document language.
  if (!$("html").attr("lang")) {
    findings.push({
      category: "accessibility",
      severity: "medium",
      title: "Missing html lang attribute",
      description: "The <html> element has no lang attribute.",
      impact: "Screen readers can't determine the page language; hurts a11y compliance.",
      fix_recommendation: 'Add a lang attribute, e.g. <html lang="en">.',
      affected_url: url,
    });
  }

  // 2. Page title.
  if (!$("head title").text().trim()) {
    findings.push({
      category: "accessibility",
      severity: "high",
      title: "Missing document title",
      description: "No non-empty <title> element found.",
      impact: "Title is the first thing assistive tech announces; also critical for SEO.",
      fix_recommendation: "Add a descriptive <title> in the document head.",
      affected_url: url,
    });
  }

  // 3. Images without alt.
  const imgsNoAlt = $("img").filter((_, el) => $(el).attr("alt") === undefined).length;
  if (imgsNoAlt > 0) {
    findings.push({
      category: "accessibility",
      severity: "medium",
      title: `${imgsNoAlt} image(s) missing alt attribute`,
      description: "Images without an alt attribute are invisible to screen readers.",
      impact: "Fails WCAG 1.1.1 (Non-text Content).",
      fix_recommendation: 'Add alt text (use alt="" for decorative images).',
      affected_url: url,
    });
  }

  // 4. Form inputs without an accessible label.
  let unlabeled = 0;
  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") || "").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button") return;
    const id = $el.attr("id");
    const hasLabel = (id && $(`label[for="${id}"]`).length > 0) || $el.attr("aria-label") || $el.attr("aria-labelledby") || $el.attr("title");
    if (!hasLabel) unlabeled += 1;
  });
  if (unlabeled > 0) {
    findings.push({
      category: "accessibility",
      severity: "medium",
      title: `${unlabeled} form control(s) without a label`,
      description: "Form fields lack an associated <label>, aria-label, or aria-labelledby.",
      impact: "Fails WCAG 3.3.2 / 4.1.2; users can't tell what to enter.",
      fix_recommendation: "Associate every control with a visible <label for> or an aria-label.",
      affected_url: url,
    });
  }

  // 5. Links without discernible text.
  let emptyLinks = 0;
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const hasAccName = text || $el.attr("aria-label") || $el.attr("title") || $el.find("img[alt]").attr("alt");
    if (!hasAccName) emptyLinks += 1;
  });
  if (emptyLinks > 0) {
    findings.push({
      category: "accessibility",
      severity: "low",
      title: `${emptyLinks} link(s) without discernible text`,
      description: "Links with no text and no accessible name can't be understood by screen readers.",
      impact: "Fails WCAG 2.4.4 (Link Purpose).",
      fix_recommendation: "Add link text or an aria-label describing the destination.",
      affected_url: url,
    });
  }

  // 6. Buttons without an accessible name.
  let emptyButtons = 0;
  $("button").each((_, el) => {
    const $el = $(el);
    const hasName = $el.text().trim() || $el.attr("aria-label") || $el.attr("title");
    if (!hasName) emptyButtons += 1;
  });
  if (emptyButtons > 0) {
    findings.push({
      category: "accessibility",
      severity: "low",
      title: `${emptyButtons} button(s) without an accessible name`,
      description: "Buttons with no text/aria-label can't be operated by assistive tech.",
      impact: "Fails WCAG 4.1.2 (Name, Role, Value).",
      fix_recommendation: "Add visible text or aria-label to each button.",
      affected_url: url,
    });
  }

  // 7. Heading order — must start with a single h1.
  const h1Count = $("h1").length;
  if (h1Count === 0) {
    findings.push({
      category: "accessibility",
      severity: "low",
      title: "No H1 heading",
      description: "The page has no <h1> element.",
      impact: "Screen-reader users rely on a top-level heading to understand page purpose.",
      fix_recommendation: "Add exactly one descriptive <h1>.",
      affected_url: url,
    });
  } else if (h1Count > 1) {
    findings.push({
      category: "accessibility",
      severity: "low",
      title: `Multiple H1 headings (${h1Count})`,
      description: "More than one <h1> can confuse document structure.",
      impact: "Weakens heading hierarchy for assistive tech and SEO.",
      fix_recommendation: "Use a single <h1>; demote the rest to <h2>/<h3>.",
      affected_url: url,
    });
  }

  return findings;
}

function checkRichResults(html: string, url: string): { findings: QualityFinding[]; eligible: string[] } {
  const $ = cheerio.load(html);
  const findings: QualityFinding[] = [];
  const eligible: string[] = [];
  const incomplete: string[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      findings.push({
        category: "schema",
        severity: "medium",
        title: "Invalid JSON-LD block",
        description: "A JSON-LD <script> block failed to parse.",
        impact: "Malformed structured data is ignored by search engines (no rich results).",
        fix_recommendation: "Fix JSON syntax; validate with the Rich Results Test.",
        affected_url: url,
      });
      return;
    }
    const nodes = flattenJsonLd(parsed);
    for (const node of nodes) {
      const type = normalizeType(node["@type"]);
      if (!type) continue;
      const required = RICH_RESULT_REQUIREMENTS[type];
      if (!required) continue;
      const missing = required.filter((p) => node[p] === undefined || node[p] === null || node[p] === "");
      if (missing.length === 0) {
        if (!eligible.includes(type)) eligible.push(type);
      } else if (!incomplete.includes(type)) {
        incomplete.push(type);
        findings.push({
          category: "schema",
          severity: "low",
          title: `${type} schema missing rich-result properties`,
          description: `${type} is present but missing: ${missing.join(", ")}.`,
          impact: `Incomplete ${type} markup is ineligible for rich results / AI extraction.`,
          fix_recommendation: `Add the required properties (${missing.join(", ")}) to your ${type} JSON-LD.`,
          affected_url: url,
        });
      }
    }
  });

  return { findings, eligible };
}

function flattenJsonLd(parsed: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      out.push(obj);
      if (Array.isArray(obj["@graph"])) (obj["@graph"] as unknown[]).forEach(visit);
    }
  };
  visit(parsed);
  return out;
}

function normalizeType(t: unknown): string | null {
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return null;
}
