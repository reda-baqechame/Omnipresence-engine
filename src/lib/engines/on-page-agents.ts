/**
 * Six on-page SEO agents (AEO Engine pattern) — propose fixes from live page data.
 * Inspired by python-seo-analyzer / SEOnaut concepts; runs in-app via fetch + cheerio patterns.
 */

export interface OnPageFixProposal {
  agent: "title" | "meta" | "alt" | "h1" | "freshness" | "schema" | "qc";
  url: string;
  field: string;
  current?: string;
  proposed: string;
  confidence: number;
  rationale: string;
}

export interface PageSnapshot {
  url: string;
  title?: string;
  meta_description?: string;
  h1?: string;
  schema_types: string[];
  word_count: number;
  year_in_title?: boolean;
  images_without_alt?: number;
}

function currentYear(): number {
  return new Date().getFullYear();
}

export function runOnPageAgents(
  page: PageSnapshot,
  brandName: string,
  primaryKeyword?: string
): OnPageFixProposal[] {
  const fixes: OnPageFixProposal[] = [];
  const kw = primaryKeyword || brandName;

  if (!page.title || page.title.length < 30 || page.title.length > 65) {
    const proposed = `${kw} — ${brandName} | Expert ${currentYear()} Guide`.slice(0, 60);
    fixes.push({
      agent: "title",
      url: page.url,
      field: "title",
      current: page.title,
      proposed,
      confidence: page.title ? 75 : 90,
      rationale: "Title should be 30–60 chars with brand + primary keyword for SERP/AI snippets.",
    });
  }

  if (!page.meta_description || page.meta_description.length < 120) {
    fixes.push({
      agent: "meta",
      url: page.url,
      field: "meta_description",
      current: page.meta_description,
      proposed: `Learn about ${kw} from ${brandName}. Clear answers, proof points, and next steps — trusted by customers in ${currentYear()}.`.slice(0, 155),
      confidence: 85,
      rationale: "Meta description 120–155 chars improves CTR and AI summary eligibility.",
    });
  }

  if (page.year_in_title || (page.title && /\b20(1[0-9]|2[0-4])\b/.test(page.title))) {
    fixes.push({
      agent: "freshness",
      url: page.url,
      field: "title",
      current: page.title,
      proposed: (page.title || "").replace(/\b20(1[0-9]|2[0-4])\b/g, String(currentYear())),
      confidence: 70,
      rationale: "Update outdated year in title for freshness signals.",
    });
  }

  if (!page.schema_types.includes("FAQPage") && page.word_count > 400) {
    fixes.push({
      agent: "schema",
      url: page.url,
      field: "schema",
      current: page.schema_types.join(", ") || "none",
      proposed: "Add FAQPage + Organization JSON-LD",
      confidence: 80,
      rationale: "FAQ schema improves AI citation and rich result eligibility.",
    });
  }

  if (!page.h1) {
    fixes.push({
      agent: "h1",
      url: page.url,
      field: "h1",
      current: undefined,
      proposed: kw,
      confidence: 88,
      rationale: "Missing H1 — add primary keyword as heading.",
    });
  }

  if ((page.images_without_alt ?? 0) > 0) {
    fixes.push({
      agent: "alt",
      url: page.url,
      field: "img_alt",
      current: `${page.images_without_alt} images missing alt`,
      proposed: `Add descriptive alt text to ${page.images_without_alt} images (include ${kw} where natural)`,
      confidence: 82,
      rationale: "Image alt text improves accessibility and image search visibility.",
    });
  }

  if (page.word_count < 300) {
    fixes.push({
      agent: "qc",
      url: page.url,
      field: "content",
      current: `${page.word_count} words`,
      proposed: "Expand to 500+ words with direct answers in first paragraph",
      confidence: 65,
      rationale: "Thin content underperforms in AI Overviews and organic search.",
    });
  }

  return fixes;
}
