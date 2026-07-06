import type { IntelligenceReportSectionId } from "@/types/intelligence-report";

export interface ReportPreset {
  id: string;
  name: string;
  description: string;
  reportType: "standard" | "deep";
  sections: IntelligenceReportSectionId[];
}

/** Professional report presets — sections[] configs on top of existing builder. */
export const REPORT_PRESETS: ReportPreset[] = [
  {
    id: "executive_audit",
    name: "Executive Organic Growth Audit",
    description: "OmniPresence score, competitive snapshot, top issues, 90-day roadmap.",
    reportType: "deep",
    sections: ["executive", "competitive", "technical", "keywords", "roadmap", "methodology"],
  },
  {
    id: "technical_seo",
    name: "Technical SEO Audit",
    description: "Crawl findings, CWV, indexation gaps, fix priorities.",
    reportType: "deep",
    sections: ["executive", "technical", "schema", "proof", "methodology"],
  },
  {
    id: "keyword_demand",
    name: "Keyword & Search Demand",
    description: "Opportunity keywords, striking distance, content gaps.",
    reportType: "deep",
    sections: ["executive", "keywords", "competitive", "roadmap", "methodology"],
  },
  {
    id: "competitive_intel",
    name: "Competitive Intelligence",
    description: "Head-to-head visibility, popularity, win/loss prompts.",
    reportType: "deep",
    sections: ["executive", "competitive", "visibility", "ppc", "methodology"],
  },
  {
    id: "backlink_authority",
    name: "Backlink & Authority",
    description: "Referring domains, link gaps, outreach opportunities.",
    reportType: "deep",
    sections: ["executive", "backlinks", "community", "reputation", "methodology"],
  },
  {
    id: "local_seo",
    name: "Local SEO Dominance",
    description: "GBP/listings coverage, NAP consistency, local gaps.",
    reportType: "deep",
    sections: ["executive", "local", "entity", "competitive", "methodology"],
  },
  {
    id: "aeo_geo",
    name: "AI Visibility / AEO-GEO",
    description: "AI mention/citation rates, source graph, prompt wins/losses.",
    reportType: "deep",
    sections: ["executive", "visibility", "competitive", "community", "proof", "methodology"],
  },
  {
    id: "attribution_roi",
    name: "Organic Revenue Attribution",
    description: "Traffic, leads, revenue, paid-ad equivalent, ROI proof.",
    reportType: "deep",
    sections: ["executive", "roi", "proof", "roadmap", "methodology"],
  },
  {
    id: "standard_summary",
    name: "Standard Summary",
    description: "Quick OmniPresence snapshot — sync generation.",
    reportType: "standard",
    sections: [],
  },
];

export function getReportPreset(id: string): ReportPreset | undefined {
  return REPORT_PRESETS.find((p) => p.id === id);
}
