import { scrapePage } from "@/lib/providers/firecrawl";
import type { FindingSeverity } from "@/types/database";
import type { TechnicalAuditFinding } from "./technical-audit";

export async function analyzePassageReadiness(
  domain: string
): Promise<TechnicalAuditFinding[]> {
  const findings: TechnicalAuditFinding[] = [];
  const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;

  const page = await scrapePage(baseUrl);
  if (!page.success || !page.data) {
    return findings;
  }

  const data = page.data;
  const wordCount = data.wordCount || 0;
  const content = data.headings.map((h) => h.text).join(" ");

  if (wordCount < 500) {
    findings.push({
      category: "passage",
      severity: "medium",
      title: "Content too thin for AI passage extraction",
      description: `Homepage has ~${wordCount} words. AI engines prefer 500–2000 word dense pages.`,
      impact: "Low retrieval eligibility for complex buyer queries.",
      fix_recommendation: "Expand key pages with direct-answer sections and proprietary data points.",
      affected_url: baseUrl,
    });
  } else if (wordCount > 5000) {
    findings.push({
      category: "passage",
      severity: "low",
      title: "Very long page may overflow AI context windows",
      description: `Page has ~${wordCount} words. Dense shorter pages are cited more often.`,
      impact: "AI may skip long pages in favor of shorter sources.",
      fix_recommendation: "Split into focused sub-pages with clear H2 question headings.",
      affected_url: baseUrl,
    });
  }

  const h2s = data.headings.filter((h) => h.level === 2);
  const questionH2s = h2s.filter((h) =>
    /^(how|what|why|when|where|who|is|are|can|does|should)\b/i.test(h.text)
  );

  if (h2s.length > 0 && questionH2s.length / h2s.length < 0.3) {
    findings.push({
      category: "passage",
      severity: "medium",
      title: "H2 headings not phrased as buyer questions",
      description: "Only a minority of H2s match question-style phrasing AI retrievers prefer.",
      impact: "Lower match rate for conversational AI queries.",
      fix_recommendation: 'Rewrite H2s as questions: "How much does X cost?" not "Pricing overview".',
      affected_url: baseUrl,
    });
  }

  const paragraphs = [content].filter((p) => p.trim().length > 40);
  const directAnswerLeads = paragraphs.filter((p) => {
    const words = p.split(/\s+/).length;
    return words >= 40 && words <= 120;
  });

  if (paragraphs.length > 2 && directAnswerLeads.length / paragraphs.length < 0.25) {
    findings.push({
      category: "passage",
      severity: "high",
      title: "Missing direct-answer lead paragraphs",
      description: "Sections lack 40–80 word answer-first blocks AI can lift verbatim.",
      impact: "Major citation eligibility gap per Google/OpenAI guidance.",
      fix_recommendation: "Lead each section with a direct answer in the first 1–2 sentences.",
      affected_url: baseUrl,
    });
  }

  const hasStats = /\d+%|\$[\d,]+|\d{4}|\d+\s*(years?|clients?|reviews?)/i.test(content);
  if (!hasStats) {
    findings.push({
      category: "passage",
      severity: "medium",
      title: "No proprietary facts or statistics detected",
      description: "Pages without specific numbers/dates are cited less often.",
      impact: "Generic claims are skipped by citation selectors.",
      fix_recommendation: "Add sourced stats, case metrics, or original data points.",
      affected_url: baseUrl,
    });
  }

  const modified = undefined as string | undefined;
  if (modified) {
    const age = Date.now() - new Date(modified).getTime();
    const days = age / (1000 * 60 * 60 * 24);
    if (days > 90) {
      findings.push({
        category: "freshness",
        severity: days > 180 ? "high" : "medium",
        title: "Content appears stale",
        description: `Last modified signal is ${Math.round(days)} days old.`,
        impact: "Fresh content receives ~3x more AI citations.",
        fix_recommendation: "Update with new stats, case studies, or corrected claims.",
        affected_url: baseUrl,
      });
    }
  } else {
    findings.push({
      category: "freshness",
      severity: "low",
      title: "No publish/modified date detected",
      description: "Missing date signals in metadata or visible content.",
      fix_recommendation: "Add datePublished and dateModified in Article schema and visible text.",
      affected_url: baseUrl,
    });
  }

  return findings;
}

export function passageReadinessScore(findings: TechnicalAuditFinding[]): number {
  const passage = findings.filter((f) => f.category === "passage" || f.category === "freshness");
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
