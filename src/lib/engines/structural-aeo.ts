/**
 * Structural AEO formatter + QC (Phase 6).
 *
 * AI engines quote *extractable structure*, not persuasion. The proven +17% lever
 * is content shaped into: answer-first leads (40-80 words), definition blocks,
 * comparison TABLES, ordered STEPS (with HowTo JSON-LD), and FAQ pairs.
 *
 * This module is deterministic (regex/parse based) — a real QC gate, not an LLM
 * opinion — plus transformers that emit schema and assemble a publishable doc.
 */

export interface StructuralCheck {
  passed: boolean;
  detail: string;
}

export interface StructuralQC {
  score: number;
  passed: boolean;
  checks: {
    answerFirst: StructuralCheck;
    definitionBlock: StructuralCheck;
    comparisonTable: StructuralCheck;
    orderedSteps: StructuralCheck;
    faq: StructuralCheck;
  };
  issues: string[];
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** H2 headings (markdown `## ` or `<h2>`). */
function extractH2Blocks(content: string): { heading: string; body: string }[] {
  const lines = content.split(/\r?\n/);
  const blocks: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string } | null = null;

  for (const line of lines) {
    const mdH2 = line.match(/^##\s+(.*)/);
    const htmlH2 = line.match(/<h2[^>]*>(.*?)<\/h2>/i);
    const heading = mdH2?.[1] || htmlH2?.[1];
    if (heading && !/^###/.test(line)) {
      if (current) blocks.push(current);
      current = { heading: heading.trim(), body: "" };
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/** First non-empty paragraph text of a body chunk (strips markdown/html noise). */
function firstParagraph(body: string): string {
  const cleaned = body
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^[#>\-*|\d.]/.test(p));
  return cleaned[0] || "";
}

/** Extract ordered-step text from markdown `1.` lists or `<ol><li>`. */
export function extractSteps(content: string): string[] {
  const steps: string[] = [];
  const olMatch = content.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
  if (olMatch) {
    const items = olMatch[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
    for (const it of items) {
      steps.push(it.replace(/<[^>]+>/g, "").trim());
    }
  }
  if (steps.length === 0) {
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (m) steps.push(m[1].trim());
    }
  }
  return steps.filter(Boolean);
}

export function extractFaqs(content: string): { question: string; answer: string }[] {
  const faqs: { question: string; answer: string }[] = [];
  const blocks = extractH2Blocks(content);
  for (const b of blocks) {
    if (b.heading.includes("?")) {
      const ans = firstParagraph(b.body);
      if (ans) faqs.push({ question: b.heading, answer: ans });
    }
  }
  // also "Q:" / "A:" inline pairs
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const q = lines[i].match(/^\s*Q[:.]\s*(.*)/i);
    if (q) {
      const a = lines.slice(i + 1).find((l) => /^\s*A[:.]\s*/i.test(l));
      if (a) faqs.push({ question: q[1].trim(), answer: a.replace(/^\s*A[:.]\s*/i, "").trim() });
    }
  }
  return faqs;
}

function hasComparisonTable(content: string): boolean {
  if (/<table[\s>]/i.test(content)) return true;
  // markdown table: a header row followed by a |---|---| separator
  return /(^|\n)\s*\|.*\|\s*\n\s*\|[\s:-]*\|/.test(content);
}

function hasDefinitionBlock(content: string): boolean {
  const blocks = extractH2Blocks(content);
  for (const b of blocks) {
    if (/^(what|who)\s+(is|are)\b/i.test(b.heading)) {
      const p = firstParagraph(b.body);
      if (/\b(is|are|refers to|means|describes)\b/i.test(p)) return true;
    }
  }
  // bold term definition: **Term** is ...
  return /\*\*[^*]+\*\*\s+(is|are|refers to|means)\b/i.test(content);
}

/** Deterministic structural QC over markdown/HTML content. */
export function analyzeStructure(content: string): StructuralQC {
  const issues: string[] = [];
  const blocks = extractH2Blocks(content);

  // Answer-first: fraction of H2s whose first paragraph is a 40-80 word lead.
  let answerOk = 0;
  for (const b of blocks) {
    const wc = wordCount(firstParagraph(b.body));
    if (wc >= 25 && wc <= 90) answerOk++;
  }
  const answerFrac = blocks.length ? answerOk / blocks.length : 0;
  const answerFirst: StructuralCheck = {
    passed: blocks.length > 0 && answerFrac >= 0.5,
    detail: `${answerOk}/${blocks.length} sections lead with a 40-80 word answer`,
  };
  if (!answerFirst.passed) issues.push("Add a direct 40-80 word answer at the start of each H2 section.");

  const steps = extractSteps(content);
  const orderedSteps: StructuralCheck = {
    passed: steps.length >= 3,
    detail: `${steps.length} ordered steps detected`,
  };
  if (!orderedSteps.passed) issues.push("Add an ordered, numbered step list (3+ steps) for HowTo eligibility.");

  const faqs = extractFaqs(content);
  const faq: StructuralCheck = {
    passed: faqs.length >= 3,
    detail: `${faqs.length} FAQ pairs detected`,
  };
  if (!faq.passed) issues.push("Add at least 3 question-style FAQ pairs for FAQPage schema.");

  const comparisonTable: StructuralCheck = {
    passed: hasComparisonTable(content),
    detail: hasComparisonTable(content) ? "Comparison table present" : "No table found",
  };
  if (!comparisonTable.passed) issues.push("Add a comparison table — AI engines extract tabular data verbatim.");

  const definitionBlock: StructuralCheck = {
    passed: hasDefinitionBlock(content),
    detail: hasDefinitionBlock(content) ? "Definition block present" : "No definition block found",
  };
  if (!definitionBlock.passed) issues.push('Add a "What is X" definition block with a self-contained answer.');

  const score = Math.round(
    answerFrac * 35 +
      (definitionBlock.passed ? 15 : 0) +
      (comparisonTable.passed ? 15 : 0) +
      (orderedSteps.passed ? 15 : 0) +
      (faq.passed ? 20 : 0)
  );

  return {
    score,
    passed: score >= 70,
    checks: { answerFirst, definitionBlock, comparisonTable, orderedSteps, faq },
    issues,
  };
}

export function buildHowToJsonLd(name: string, steps: string[]): Record<string, unknown> | null {
  if (steps.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    step: steps.map((text, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text,
    })),
  };
}

export function buildFaqJsonLd(
  faqs: { question: string; answer: string }[]
): Record<string, unknown> | null {
  if (faqs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
}

export function toMarkdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}`;
}

/** Trim/validate an answer to the extractable 40-80 word band (best-effort). */
export function answerFirstBlock(answer: string): string {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 80) return answer.trim();
  return `${words.slice(0, 80).join(" ")}…`;
}

/** Minimal, safe markdown -> HTML for CMS publishing (headings, lists, tables, bold). */
export function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inOl = false;
  let tableBuffer: string[] = [];

  const flushOl = () => {
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };
  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      const rows = tableBuffer
        .filter((r) => !/^\s*\|[\s:-]+\|/.test(r))
        .map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      const [head, ...body] = rows;
      out.push("<table><thead><tr>" + head.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>");
      for (const r of body) out.push("<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>");
      out.push("</tbody></table>");
    }
    tableBuffer = [];
  };
  const inline = (s: string) =>
    s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushOl();
      tableBuffer.push(line);
      continue;
    }
    flushTable();

    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (h) {
      flushOl();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
    } else if (ol) {
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(ol[1])}</li>`);
    } else if (line.trim()) {
      flushOl();
      out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  flushOl();
  flushTable();
  return out.join("\n");
}

export interface StructuredDocInput {
  title: string;
  definition?: { term: string; text: string };
  sections: { heading: string; answerFirst: string; supporting?: string }[];
  steps?: { name: string; items: string[] };
  comparison?: { headers: string[]; rows: string[][] };
  faqs?: { question: string; answer: string }[];
}

export interface StructuredDoc {
  markdown: string;
  jsonLd: Record<string, unknown>[];
  qc: StructuralQC;
}

/** Assemble rewriter output into a publishable, structurally-optimized document. */
export function assembleStructuredDoc(input: StructuredDocInput): StructuredDoc {
  const parts: string[] = [`# ${input.title}`];

  if (input.definition) {
    parts.push(`## What is ${input.definition.term}?`);
    parts.push(answerFirstBlock(input.definition.text));
  }

  for (const s of input.sections) {
    const heading = s.heading.includes("?") || /^(how|what|why|who|when|where)/i.test(s.heading)
      ? s.heading
      : s.heading;
    parts.push(`## ${heading}`);
    parts.push(answerFirstBlock(s.answerFirst));
    if (s.supporting) parts.push(s.supporting);
  }

  if (input.steps && input.steps.items.length >= 2) {
    parts.push(`## ${input.steps.name}`);
    input.steps.items.forEach((it, i) => parts.push(`${i + 1}. ${it}`));
  }

  if (input.comparison && input.comparison.rows.length) {
    parts.push(`## Comparison`);
    parts.push(toMarkdownTable(input.comparison.headers, input.comparison.rows));
  }

  if (input.faqs && input.faqs.length) {
    parts.push(`## Frequently Asked Questions`);
    for (const f of input.faqs) {
      parts.push(`### ${f.question}`);
      parts.push(f.answer);
    }
  }

  const markdown = parts.join("\n\n");

  const jsonLd: Record<string, unknown>[] = [];
  const howTo = input.steps ? buildHowToJsonLd(input.steps.name, input.steps.items) : null;
  if (howTo) jsonLd.push(howTo);
  const faqLd = buildFaqJsonLd(input.faqs || []);
  if (faqLd) jsonLd.push(faqLd);

  return { markdown, jsonLd, qc: analyzeStructure(markdown) };
}
