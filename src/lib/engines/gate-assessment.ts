import type { CitationGate } from "@/types/database";
import type { TechnicalAuditFinding } from "./technical-audit";

export interface GateAssessment {
  gate: CitationGate;
  label: string;
  passed: boolean;
  score: number;
  blockers: string[];
}

const GATE_LABELS: Record<CitationGate, string> = {
  index: "Gate 1: Search Index",
  crawl: "Gate 2: AI Crawl Access",
  retrieval: "Gate 3: Retrieval Readiness",
  citation: "Gate 4: Citation Signals",
};

export function assessCitationGates(findings: TechnicalAuditFinding[]): {
  gates: GateAssessment[];
  timeToCitationBlocker?: string;
  overallPassed: boolean;
} {
  const byCategory = (cats: string[]) =>
    findings.filter((f) => cats.includes(f.category));

  const critical = findings.filter((f) => f.severity === "critical" || f.severity === "high");

  const indexFindings = byCategory(["crawlability", "sitemap", "indexability"]);
  const crawlFindings = byCategory(["robots", "ai_bot_access"]);
  const retrievalFindings = byCategory(["schema", "on_page", "passage", "meta", "content"]);
  const citationFindings = byCategory(["entity", "freshness", "authority"]);

  const gate = (
    id: CitationGate,
    cats: string[],
    extraBlockers: string[] = []
  ): GateAssessment => {
    const relevant = byCategory(cats);
    const blockers = [
      ...relevant
        .filter((f) => f.severity === "critical" || f.severity === "high")
        .map((f) => f.title),
      ...extraBlockers,
    ];
    const penalty = relevant.reduce((sum, f) => {
      if (f.severity === "critical") return sum + 40;
      if (f.severity === "high") return sum + 25;
      if (f.severity === "medium") return sum + 10;
      return sum + 3;
    }, 0);
    const score = Math.max(0, 100 - penalty);
    return {
      gate: id,
      label: GATE_LABELS[id],
      passed: blockers.length === 0 && score >= 60,
      score,
      blockers,
    };
  };

  const gates = [
    gate("index", ["crawlability", "sitemap", "indexability"]),
    gate("crawl", ["robots", "ai_bot_access"]),
    gate("retrieval", ["schema", "on_page", "passage", "meta", "content"]),
    gate("citation", ["entity", "freshness", "authority"]),
  ];

  const oaiBlocked = crawlFindings.some(
    (f) => f.title.toLowerCase().includes("oai-searchbot") && f.severity !== "low"
  );

  const timeToCitationBlocker = oaiBlocked
    ? "OAI-SearchBot is blocked — ChatGPT Search cannot cite your pages."
    : critical[0]?.title;

  return {
    gates,
    timeToCitationBlocker,
    overallPassed: gates.every((g) => g.passed),
  };
}
