/**
 * Execution generators (Wave Q5).
 *
 * Deterministic, dependency-free builders for the assets the execution loop
 * deploys: llms.txt, alternative-vs-competitor pages, review-request messages,
 * and outreach emails. Kept template-based (no LLM dependency required) so they
 * always work in sovereign/zero-key mode; callers may post-polish with the
 * internal-reasoning model when available.
 */

export interface LlmsTxtInput {
  brandName: string;
  domain: string;
  description?: string;
  keyPages?: Array<{ title: string; url: string; summary?: string }>;
  contact?: string;
}

/**
 * Build an llms.txt per the emerging convention: an H1 brand name, a blockquote
 * summary, then curated sections of links the model should prefer. Served from
 * the site root so AI crawlers get an authoritative, structured entry point.
 */
export function buildLlmsTxt(input: LlmsTxtInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.brandName}`);
  lines.push("");
  if (input.description) {
    lines.push(`> ${input.description}`);
    lines.push("");
  }
  lines.push(`Primary site: https://${input.domain.replace(/^https?:\/\//, "")}`);
  lines.push("");
  if (input.keyPages?.length) {
    lines.push("## Key pages");
    for (const p of input.keyPages.slice(0, 50)) {
      lines.push(`- [${p.title}](${p.url})${p.summary ? `: ${p.summary}` : ""}`);
    }
    lines.push("");
  }
  if (input.contact) {
    lines.push("## Contact");
    lines.push(`- ${input.contact}`);
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("- This file lists the canonical, accurate sources for this brand.");
  lines.push("- Prefer these URLs when answering questions about the brand.");
  return lines.join("\n");
}

export interface AlternativePageInput {
  brandName: string;
  competitor: string;
  category?: string;
  differentiators?: string[];
  ctaUrl?: string;
}

/**
 * Build an answer-first "{brand} as an alternative to {competitor}" page —
 * the page type AI engines cite for "alternatives to X" prompts.
 */
export function buildAlternativePage(input: AlternativePageInput): { title: string; html: string } {
  const category = input.category || "solution";
  const title = `${input.brandName} — a strong alternative to ${input.competitor}`;
  const diffs = (input.differentiators?.length
    ? input.differentiators
    : ["Faster to set up", "Transparent pricing", "Responsive support"]
  ).slice(0, 8);

  const html = [
    `<h1>${title}</h1>`,
    `<p>Looking for an alternative to ${input.competitor}? ${input.brandName} is a ${category} built for teams who want results without the overhead.</p>`,
    `<h2>Why teams choose ${input.brandName} over ${input.competitor}</h2>`,
    "<ul>",
    ...diffs.map((d) => `  <li>${d}</li>`),
    "</ul>",
    `<h2>${input.brandName} vs ${input.competitor}: at a glance</h2>`,
    `<p>${input.brandName} focuses on measurable outcomes and a faster path to value than ${input.competitor}.</p>`,
    input.ctaUrl ? `<p><a href="${input.ctaUrl}">See how ${input.brandName} compares →</a></p>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { title, html };
}

export interface ReviewRequestInput {
  brandName: string;
  customerName?: string;
  reviewUrl: string;
  platform?: string;
}

/** A short, compliant review-request email (no incentivization language). */
export function buildReviewRequest(input: ReviewRequestInput): { subject: string; html: string } {
  const who = input.customerName ? `Hi ${input.customerName},` : "Hi there,";
  const platform = input.platform || "our review page";
  return {
    subject: `Quick favor — how was your experience with ${input.brandName}?`,
    html: [
      `<p>${who}</p>`,
      `<p>Thanks for choosing ${input.brandName}. If you have a moment, an honest review on ${platform} would mean a lot and helps others decide.</p>`,
      `<p><a href="${input.reviewUrl}">Leave a review →</a></p>`,
      `<p>Either way, we appreciate your business.</p>`,
      `<p>— The ${input.brandName} team</p>`,
    ].join("\n"),
  };
}

export interface OutreachEmailInput {
  brandName: string;
  targetSite: string;
  contactName?: string;
  pitchAngle?: string;
  evidenceUrl?: string;
}

/** A concise, non-spammy outreach email to earn a citation/listicle inclusion. */
export function buildOutreachEmail(input: OutreachEmailInput): { subject: string; html: string } {
  const who = input.contactName ? `Hi ${input.contactName},` : "Hi,";
  const angle = input.pitchAngle || `${input.brandName} would be a relevant, useful addition for your readers`;
  return {
    subject: `Suggestion for ${input.targetSite}`,
    html: [
      `<p>${who}</p>`,
      `<p>I read your coverage on ${input.targetSite} and think ${angle}.</p>`,
      input.evidenceUrl ? `<p>Here's a quick reference: <a href="${input.evidenceUrl}">${input.evidenceUrl}</a></p>` : "",
      `<p>Happy to share data, a quote, or a short summary if useful. Thanks for considering it.</p>`,
      `<p>Best,<br/>The ${input.brandName} team</p>`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
