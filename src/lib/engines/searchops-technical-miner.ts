/**
 * SearchOps Technical SEO miner — pure functions over already-loaded snapshots.
 * Never calls PageSpeed, CrUX, crawlers, or paid providers.
 */
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import type { DataQuality } from "@/types/database";

export type CwvHistoryRow = {
  collected_on?: string | null;
  lcp_ms?: number | null;
  inp_ms?: number | null;
  cls?: number | null;
  data_source?: string | null;
};

export type SchemaFindingRow = {
  id?: string;
  severity: string;
  title: string;
  category?: string | null;
  description?: string | null;
  affected_url?: string | null;
  fix_recommendation?: string | null;
  data_quality?: DataQuality | null;
  data_source?: DataQuality | string | null;
};

export type InternalLinkOppRow = {
  id?: string;
  source_url: string;
  target_url: string;
  anchor_suggestion?: string | null;
  relevance_score?: number | null;
  status?: string | null;
};

export type CrawlPageCanonicalRow = {
  url: string;
  canonical?: string | null;
};

const LCP_THRESHOLD_MS = 2500;
const INP_THRESHOLD_MS = 200;
const CLS_THRESHOLD = 0.1;

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    // Trailing slash normalize (keep root slash).
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Field CWV opportunities from cwv_history.
 * Empty history → [] (never invents "0 failed CWV").
 */
export function mineCwvOpportunities(
  projectId: string,
  history: CwvHistoryRow[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 6;
  if (!history.length) return [];

  // Prefer newest first.
  const sorted = [...history].sort((a, b) =>
    String(b.collected_on || "").localeCompare(String(a.collected_on || ""))
  );
  const latest = sorted[0];
  const previous = sorted[1] ?? null;
  const out: SearchOpsOpportunity[] = [];
  const freshness = latest.collected_on || null;
  const sourceLabel = "cwv_history (CrUX field)";

  const checks: Array<{
    metric: "LCP" | "INP" | "CLS";
    value: number | null;
    prev: number | null;
    threshold: number;
    unit: string;
    worse: (curr: number, prev: number) => boolean;
  }> = [
    {
      metric: "LCP",
      value: latest.lcp_ms != null ? Number(latest.lcp_ms) : null,
      prev: previous?.lcp_ms != null ? Number(previous.lcp_ms) : null,
      threshold: LCP_THRESHOLD_MS,
      unit: "ms",
      worse: (c, p) => c > p * 1.1 && c - p >= 200,
    },
    {
      metric: "INP",
      value: latest.inp_ms != null ? Number(latest.inp_ms) : null,
      prev: previous?.inp_ms != null ? Number(previous.inp_ms) : null,
      threshold: INP_THRESHOLD_MS,
      unit: "ms",
      worse: (c, p) => c > p * 1.1 && c - p >= 20,
    },
    {
      metric: "CLS",
      value: latest.cls != null ? Number(latest.cls) : null,
      prev: previous?.cls != null ? Number(previous.cls) : null,
      threshold: CLS_THRESHOLD,
      unit: "",
      worse: (c, p) => c > p * 1.15 && c - p >= 0.05,
    },
  ];

  for (const c of checks) {
    if (c.value == null || !Number.isFinite(c.value)) continue;
    const overThreshold = c.value > c.threshold;
    const regressed = c.prev != null && Number.isFinite(c.prev) && c.worse(c.value, c.prev);
    if (!overThreshold && !regressed) continue;

    const display =
      c.metric === "CLS" ? c.value.toFixed(3) : String(Math.round(c.value));
    const threshDisplay =
      c.metric === "CLS" ? String(c.threshold) : String(c.threshold);
    const reason = overThreshold
      ? `${c.metric} ${display}${c.unit} exceeds field threshold ${threshDisplay}${c.unit}`
      : `${c.metric} regressed from ${c.prev}${c.unit} to ${display}${c.unit}`;

    out.push({
      id: `${projectId}:cwv:${c.metric.toLowerCase()}`,
      projectId,
      category: "technical",
      title: `Field CWV issue: ${c.metric} ${overThreshold ? "above threshold" : "regressed"}`,
      diagnosis: `CrUX field data (${freshness || "latest"}): ${reason}. Lab Lighthouse scores are separate and not used here.`,
      evidence: [
        {
          label: `Field ${c.metric}`,
          source: sourceLabel,
          status: "measured",
          confidence: 0.9,
          value: {
            metric: c.metric,
            current: c.value,
            previous: c.prev,
            threshold: c.threshold,
            collected_on: freshness,
            data_source: latest.data_source || "crux",
          },
        },
      ],
      priority: overThreshold && c.metric !== "CLS" ? "high" : "medium",
      impactType: "measured",
      effort: "high",
      recommendedAction:
        c.metric === "LCP"
          ? "Reduce largest contentful paint on the origin (image/LCP element, server TTFB, critical CSS) and re-collect CrUX history."
          : c.metric === "INP"
            ? "Reduce interaction latency (long tasks, third-party scripts) on the origin and re-collect CrUX history."
            : "Stabilize layout shifts (reserve media space, avoid late font/layout inserts) and re-collect CrUX history.",
      verificationPlan: `Re-check cwv_history ${c.metric} for the same origin after the next CrUX collection window; require measured field value ≤ threshold.`,
      limitations: [
        "CrUX is origin-level field data; page-level lab scores may differ.",
        "Improving CWV does not guarantee ranking change.",
      ],
    });
  }

  return out.slice(0, max);
}

/**
 * Schema gap opportunities from technical_findings (all severities).
 * Absence evidence is measured; recommended schema type is model_knowledge.
 */
export function mineSchemaGapOpportunities(
  projectId: string,
  findings: SchemaFindingRow[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 8;
  const out: SearchOpsOpportunity[] = [];

  for (const f of findings) {
    if ((f.category || "").toLowerCase() !== "schema") continue;
    const title = f.title?.trim();
    if (!title) continue;
    const dq = (f.data_quality || f.data_source || "measured") as DataQuality;
    if (dq === "unavailable" || dq === "simulated") continue;

    const absenceStatus: "measured" | "estimated" =
      dq === "estimated" ? "estimated" : "measured";
    const affected = f.affected_url?.trim() || null;
    const fix = f.fix_recommendation?.trim() || null;
    const severity = f.severity || "medium";

    out.push({
      id: `${projectId}:schema:${f.id || title.slice(0, 48)}`,
      projectId,
      category: "technical",
      title: `Schema gap: ${title}`,
      diagnosis: `${absenceStatus === "measured" ? "Measured" : "Estimated"} crawl/audit found a schema gap${affected ? ` on ${affected}` : ""}${f.description ? `: ${f.description}` : "."}`,
      evidence: [
        {
          label: "Schema absence / gap (crawl)",
          source: "technical_findings",
          status: absenceStatus,
          confidence: absenceStatus === "measured" ? 0.85 : 0.55,
          value: {
            severity,
            category: "schema",
            affected_url: affected,
            title,
            data_quality: dq,
          },
          evidenceId: f.id ?? null,
        },
        {
          label: "Recommended schema types",
          source: "schema guidance",
          status: "model_knowledge",
          confidence: 0.5,
          value: {
            note: "Recommended types are guidance, not a ranking guarantee.",
            fix_recommendation: fix,
          },
        },
      ],
      priority:
        severity === "critical" ? "critical" : severity === "high" ? "high" : "medium",
      // Recommended type remains model_knowledge; do not claim measured ranking impact.
      impactType: "model_knowledge",
      effort: "medium",
      recommendedAction: fix
        ? `${fix}${affected ? ` Target URL: ${affected}.` : ""} Re-run technical audit after deploy.`
        : `Add relevant JSON-LD schema for the page type${affected ? ` on ${affected}` : ""}; re-run technical audit to confirm detection.`,
      verificationPlan:
        "Re-run technical audit / schema validation; confirm the schema finding is resolved or severity drops.",
      limitations: [
        absenceStatus === "measured"
          ? "Schema presence is measured; ranking or rich-result eligibility is not guaranteed."
          : "Schema absence evidence is estimated for this finding — re-crawl before treating as measured.",
        "Recommended schema types are model_knowledge, not measured impact.",
      ],
    });
  }

  return out
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, max);
}

/**
 * Internal link opportunities from stored internal_link_opportunities.
 * No crawl ever → single unavailable opportunity.
 * Crawl exists but table empty → [] (measured empty, not fake zero claim).
 */
export function mineInternalLinkOpportunities(
  projectId: string,
  rows: InternalLinkOppRow[],
  hasCrawlData: boolean,
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 8;

  if (!hasCrawlData) {
    return [
      {
        id: `${projectId}:internal_link:unavailable`,
        projectId,
        category: "technical",
        title: "Internal link opportunities unavailable",
        diagnosis:
          "No crawl_pages / internal-link analysis exists for this project — link graph evidence is unavailable, not zero.",
        evidence: [
          {
            label: "Internal link graph",
            source: "internal_link_opportunities",
            status: "unavailable",
            confidence: null,
            value: { hasCrawlData: false },
          },
        ],
        priority: "low",
        impactType: "unavailable",
        effort: "low",
        recommendedAction:
          "Run a site crawl / internal-links analysis for this project, then reopen Opportunities.",
        verificationPlan:
          "After crawl, internal_link_opportunities or crawl_pages must contain measured rows.",
        limitations: ["Cannot invent source→target link recommendations without crawl evidence."],
      },
    ];
  }

  const identified = rows
    .filter((r) => !r.status || r.status === "identified")
    .filter((r) => r.source_url && r.target_url)
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));

  if (!identified.length) return [];

  return identified.slice(0, max).map((r) => {
    const score = r.relevance_score ?? 0;
    const anchor = r.anchor_suggestion?.trim() || null;
    return {
      id: `${projectId}:internal_link:${r.id || `${r.source_url}->${r.target_url}`}`,
      projectId,
      category: "technical" as const,
      title: `Internal link: ${shortUrl(r.source_url)} → ${shortUrl(r.target_url)}`,
      diagnosis: `Measured crawl analysis suggests linking from ${r.source_url} to ${r.target_url}${anchor ? ` with anchor “${anchor}”` : ""} (relevance ${score}).`,
      evidence: [
        {
          label: "Internal link opportunity",
          source: "internal_link_opportunities",
          status: "measured" as const,
          confidence: Math.min(0.9, 0.4 + score / 100),
          value: {
            source_url: r.source_url,
            target_url: r.target_url,
            anchor_suggestion: anchor,
            relevance_score: score,
          },
          evidenceId: r.id ?? null,
        },
      ],
      priority: score >= 70 ? ("medium" as const) : ("low" as const),
      impactType: "measured" as const,
      effort: "low" as const,
      recommendedAction: `Add a contextual internal link from ${r.source_url} to ${r.target_url}${anchor ? ` using anchor “${anchor}”` : ""} where editorially appropriate.`,
      verificationPlan:
        "Re-run internal-links analysis; confirm the opportunity status moves to applied or the edge appears in crawl outbound links.",
      limitations: [
        "Relevance score is crawl/heuristic-based, not a traffic forecast.",
        "Do not add spammy or off-topic links.",
      ],
    };
  });
}

/**
 * Canonical mismatch opportunities from crawl_pages.
 * Requires real crawl rows; empty input → [].
 */
export function mineCanonicalMismatchOpportunities(
  projectId: string,
  pages: CrawlPageCanonicalRow[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 10;
  if (!pages.length) return [];

  const mismatches: Array<{ url: string; canonical: string }> = [];
  for (const p of pages) {
    const url = String(p.url || "").trim();
    const canonical = String(p.canonical || "").trim();
    if (!url || !canonical) continue;
    const nUrl = normalizeUrl(url);
    const nCanon = normalizeUrl(canonical);
    if (!nUrl || !nCanon) continue;
    if (nUrl === nCanon) continue;
    mismatches.push({ url, canonical });
  }

  return mismatches
    .sort((a, b) => a.url.localeCompare(b.url))
    .slice(0, max)
    .map((m) => ({
      id: `${projectId}:canonical:${m.url}`,
      projectId,
      category: "technical" as const,
      title: `Canonical mismatch: ${shortUrl(m.url)}`,
      diagnosis: `Crawl measured canonical “${m.canonical}” which does not match the page URL “${m.url}”.`,
      evidence: [
        {
          label: "Canonical vs page URL",
          source: "crawl_pages",
          status: "measured" as const,
          confidence: 0.9,
          value: { url: m.url, canonical: m.canonical },
        },
      ],
      priority: "medium" as const,
      impactType: "measured" as const,
      effort: "medium" as const,
      recommendedAction: `Align the canonical tag on ${m.url} with the intended indexable URL (self-canonical or intentional alternate), then re-crawl.`,
      verificationPlan:
        "Re-crawl the URL; crawl_pages.canonical must match the intended indexable URL (self-canonical when that is the intent).",
      limitations: [
        "Cross-domain or intentional alternate canonicals may be valid — verify intent before changing.",
      ],
    }));
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname || "/"}${u.search || ""}` || url;
  } catch {
    return url.length > 64 ? `${url.slice(0, 61)}…` : url;
  }
}
