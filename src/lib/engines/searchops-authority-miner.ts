/**
 * SearchOps authority / citation miner — pure functions over stored snapshots.
 * Never calls DataForSEO or live paid providers.
 */
import type { SearchOpsOpportunity } from "@/lib/engines/searchops-opportunity-engine";
import type { DataQuality } from "@/types/database";

export type BacklinkGraphSnapRow = {
  referring_domains?: number | null;
  total_links?: number | null;
  new_count?: number | null;
  lost_count?: number | null;
  data_source?: string | null;
  created_at?: string | null;
  intersection?: unknown;
};

export type SourceOpportunityRow = {
  id?: string;
  source_domain?: string | null;
  opportunity_type?: string | null;
  competitor_citations?: number | null;
  influence_score?: number | null;
  recommended_action?: string | null;
  tactic?: string | null;
  evidence?: unknown;
  status?: string | null;
  brand_present?: boolean | null;
};

type IntersectionRow = {
  source_domain?: string;
  brand_gap?: boolean;
  links_to?: string | string[];
  competitor_domain?: string;
};

function parseIntersection(raw: unknown): IntersectionRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === "object") as IntersectionRow[];
}

function dqOf(ds: string | null | undefined): DataQuality {
  const v = (ds || "").toLowerCase();
  if (v === "measured" || v === "estimated" || v === "model_knowledge" || v === "simulated" || v === "unavailable") {
    return v;
  }
  return "unavailable";
}

function staleDays(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
}

/**
 * Referring-domain gap / velocity opportunities from webgraph snapshots.
 * No snapshot / unavailable source → single unavailable opportunity (not zero RD).
 */
export function mineReferringDomainOpportunities(
  projectId: string,
  snaps: BacklinkGraphSnapRow[],
  legacyTotalCount?: number | null
): SearchOpsOpportunity[] {
  const latest = snaps[0];
  if (!latest) {
    if (legacyTotalCount != null && Number.isFinite(legacyTotalCount) && legacyTotalCount >= 0) {
      return [
        {
          id: `${projectId}:authority:legacy_snapshot_only`,
          projectId,
          category: "authority",
          title: "Referring-domain graph unavailable — legacy backlink count only",
          diagnosis: `A legacy backlink_snapshots row exists (count ${legacyTotalCount}) but no measured webgraph referring_domains snapshot. Do not treat this as verified referring domains.`,
          evidence: [
            {
              label: "Legacy backlink count",
              source: "backlink_snapshots",
              status: "estimated",
              confidence: 0.4,
              value: { total_count: legacyTotalCount },
            },
          ],
          priority: "low",
          impactType: "unavailable",
          effort: "low",
          recommendedAction:
            "Run backlink graph refresh (OmniData webgraph) so referring_domains are measured with provenance.",
          verificationPlan:
            "backlink_graph_snapshots must contain referring_domains with data_source measured/estimated and a recent created_at.",
          limitations: ["Legacy total_count is not interchangeable with referring domains."],
        },
      ];
    }
    return [
      {
        id: `${projectId}:authority:unavailable`,
        projectId,
        category: "authority",
        title: "Referring-domain data unavailable",
        diagnosis:
          "No backlink_graph_snapshots row for this project — cannot show zero referring domains.",
        evidence: [
          {
            label: "Referring domains",
            source: "backlink_graph_snapshots",
            status: "unavailable",
            confidence: null,
          },
        ],
        priority: "low",
        impactType: "unavailable",
        effort: "low",
        recommendedAction:
          "Enable OmniData Common Crawl webgraph ingest or run backlink graph refresh; do not invent referring domains.",
        verificationPlan:
          "fetch/refresh must persist measured referring_domains with data_source and created_at.",
        limitations: ["Paid indexes remain fallback-only until benchmark-proven."],
      },
    ];
  }

  const dq = dqOf(latest.data_source);
  if (dq === "unavailable" || latest.referring_domains == null) {
    return [
      {
        id: `${projectId}:authority:unavailable`,
        projectId,
        category: "authority",
        title: "Referring-domain data unavailable",
        diagnosis: "Latest webgraph snapshot marks referring domains unavailable — not zero.",
        evidence: [
          {
            label: "Referring domains",
            source: "backlink_graph_snapshots",
            status: "unavailable",
            confidence: null,
            value: { data_source: latest.data_source, created_at: latest.created_at },
          },
        ],
        priority: "low",
        impactType: "unavailable",
        effort: "low",
        recommendedAction: "Re-run backlink graph snapshot until data_source is measured or estimated.",
        verificationPlan: "Snapshot data_source must leave unavailable and referring_domains must be numeric.",
        limitations: ["Unavailable ≠ zero referring domains."],
      },
    ];
  }

  const rd = Number(latest.referring_domains);
  const age = staleDays(latest.created_at);
  const stale = age != null && age > 45;
  const confidence =
    dq === "measured" ? (stale ? 0.55 : 0.9) : dq === "estimated" ? 0.5 : 0.4;

  const out: SearchOpsOpportunity[] = [];

  if (stale) {
    out.push({
      id: `${projectId}:authority:stale_graph`,
      projectId,
      category: "authority",
      title: `Webgraph snapshot stale (${age} days) — confidence reduced`,
      diagnosis: `Latest referring_domains=${rd} from ${latest.created_at || "unknown"} is older than 45 days. Treat coverage as incomplete until refresh.`,
      evidence: [
        {
          label: "Webgraph freshness",
          source: "backlink_graph_snapshots",
          status: dq === "measured" ? "measured" : "estimated",
          confidence,
          value: {
            referring_domains: rd,
            created_at: latest.created_at,
            age_days: age,
            data_source: latest.data_source,
          },
        },
      ],
      priority: "medium",
      impactType: dq === "measured" ? "measured" : "estimated",
      effort: "low",
      recommendedAction: "Refresh the Common Crawl / OmniData webgraph snapshot for this domain.",
      verificationPlan: "New backlink_graph_snapshots.created_at must be within 14 days with finite referring_domains.",
      limitations: ["Stale graphs understate or overstate current referring domains."],
    });
  }

  const prev = snaps[1];
  if (prev && prev.referring_domains != null && Number.isFinite(Number(prev.referring_domains))) {
    const prevRd = Number(prev.referring_domains);
    const lost = latest.lost_count != null ? Number(latest.lost_count) : Math.max(0, prevRd - rd);
    if (lost >= 5 && rd < prevRd) {
      out.push({
        id: `${projectId}:authority:rd_velocity_loss`,
        projectId,
        category: "authority",
        title: `Referring-domain loss: ${prevRd} → ${rd}`,
        diagnosis: `Measured/estimated webgraph shows referring domains fell from ${prevRd} to ${rd}${latest.lost_count != null ? ` (lost_count=${latest.lost_count})` : ""}.`,
        evidence: [
          {
            label: "Referring-domain velocity",
            source: "backlink_graph_snapshots",
            status: dq === "measured" ? "measured" : "estimated",
            confidence,
            value: {
              current: rd,
              previous: prevRd,
              lost_count: latest.lost_count ?? null,
              new_count: latest.new_count ?? null,
              data_source: latest.data_source,
            },
          },
        ],
        priority: lost >= 20 ? "high" : "medium",
        impactType: dq === "measured" ? "measured" : "estimated",
        effort: "high",
        recommendedAction:
          "Audit lost referring domains in the latest top_links/diff, restore salvageable relationships, and publish citeable assets where loss concentrated.",
        verificationPlan:
          "Next webgraph snapshot must show referring_domains ≥ previous measured value or a documented recovery plan with measured new_count.",
        limitations: [
          "Webgraph coverage is incomplete; velocity is directionally useful, not a paid-index replacement.",
          "Do not claim domain authority improved unless the same source measures it.",
        ],
      });
    }
  }

  return out;
}

/**
 * Competitor link-intersection gaps from stored intersection JSON (brand_gap).
 */
export function mineCompetitorIntersectionOpportunities(
  projectId: string,
  latest: BacklinkGraphSnapRow | null | undefined,
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 8;
  if (!latest) return [];
  const dq = dqOf(latest.data_source);
  if (dq === "unavailable" || dq === "simulated") return [];

  const rows = parseIntersection(latest.intersection).filter(
    (r) => r.brand_gap === true && String(r.source_domain || "").trim()
  );
  if (!rows.length) return [];

  return rows
    .slice(0, max)
    .map((r) => {
      const domain = String(r.source_domain).trim();
      const linksTo = Array.isArray(r.links_to) ? r.links_to.join(", ") : String(r.links_to || "competitors");
      return {
        id: `${projectId}:authority:intersection:${domain}`,
        projectId,
        category: "authority" as const,
        title: `Competitor link gap: ${domain}`,
        diagnosis: `Stored webgraph intersection marks ${domain} as linking to competitors (${linksTo}) without a brand link (brand_gap).`,
        evidence: [
          {
            label: "Link intersection gap",
            source: "backlink_graph_snapshots.intersection",
            status: dq === "measured" ? ("measured" as const) : ("estimated" as const),
            confidence: dq === "measured" ? 0.75 : 0.5,
            value: { source_domain: domain, links_to: r.links_to, brand_gap: true },
          },
        ],
        priority: "medium" as const,
        impactType: dq === "measured" ? ("measured" as const) : ("estimated" as const),
        effort: "high" as const,
        recommendedAction: `Evaluate editorial fit for earning a citation from ${domain} with original research or a relevant resource — avoid spammy link outreach language.`,
        verificationPlan:
          "Refresh webgraph intersection; brand_gap for this source_domain should clear when a brand URL appears in referring links.",
        limitations: [
          "Intersection coverage depends on webgraph freshness and crawler bias.",
          "No guaranteed ranking or domain-authority lift.",
        ],
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * AI / source-graph citation opportunities where competitors are present and brand is not.
 */
export function mineSourceCitationGapOpportunities(
  projectId: string,
  rows: SourceOpportunityRow[],
  opts: { max?: number } = {}
): SearchOpsOpportunity[] {
  const max = opts.max ?? 8;
  const open = rows.filter(
    (r) =>
      (!r.status || r.status === "open" || r.status === "identified") &&
      (r.opportunity_type === "citation_gap" || r.brand_present === false) &&
      String(r.source_domain || "").trim()
  );
  if (!open.length) return [];

  return open
    .sort((a, b) => (b.influence_score ?? 0) - (a.influence_score ?? 0) || (b.competitor_citations ?? 0) - (a.competitor_citations ?? 0))
    .slice(0, max)
    .map((r) => {
      const domain = String(r.source_domain).trim();
      const comps = Number(r.competitor_citations ?? 0);
      const score = Number(r.influence_score ?? 0);
      const action =
        r.recommended_action?.trim() ||
        `Build a citeable asset that belongs on ${domain} (original data, expert Q&A, or primary research) — no spammy backlink language.`;
      return {
        id: `${projectId}:authority:source_gap:${r.id || domain}`,
        projectId,
        category: "authority" as const,
        title: `Citation/source opportunity: ${domain}`,
        diagnosis: `Source graph lists ${domain} as a citation gap${comps ? ` with ${comps} competitor citation signal(s)` : ""}${score ? ` (influence ${score})` : ""}.`,
        evidence: [
          {
            label: "Source opportunity",
            source: "source_opportunities",
            status: "measured" as const,
            confidence: Math.min(0.9, 0.45 + Math.min(score, 100) / 200),
            value: {
              source_domain: domain,
              competitor_citations: comps,
              influence_score: score,
              tactic: r.tactic ?? null,
              evidence: r.evidence ?? null,
            },
            evidenceId: r.id ?? null,
          },
        ],
        priority: comps >= 3 || score >= 70 ? ("high" as const) : ("medium" as const),
        impactType: "measured" as const,
        effort: "high" as const,
        recommendedAction: action,
        verificationPlan:
          "Rebuild source graph / re-run visibility probes; source_opportunities.brand_present should become true or the gap status close for this domain.",
        limitations: [
          "Source influence is not paid Domain Rating.",
          "No guaranteed LLM or search citation claim.",
        ],
      };
    });
}

/**
 * Aggregate authority deep mining for SearchOps.
 */
export function mineAuthorityOpportunities(
  projectId: string,
  opts: {
    graphSnaps?: BacklinkGraphSnapRow[];
    legacyTotalCount?: number | null;
    sourceOpportunities?: SourceOpportunityRow[];
    /** When false, skip generating the unavailable RD card (engine still has a built-in). */
    emitUnavailableCard?: boolean;
  } = {}
): SearchOpsOpportunity[] {
  const snaps = opts.graphSnaps || [];
  const rdOps = mineReferringDomainOpportunities(projectId, snaps, opts.legacyTotalCount);
  // Avoid duplicating the engine's built-in unavailable card when only that.
  const filteredRd =
    opts.emitUnavailableCard === false
      ? rdOps.filter((o) => !o.id.endsWith(":authority:unavailable"))
      : rdOps;

  const intersection = mineCompetitorIntersectionOpportunities(projectId, snaps[0]);
  const sourceGaps = mineSourceCitationGapOpportunities(projectId, opts.sourceOpportunities || []);

  const merged = [...filteredRd, ...intersection, ...sourceGaps];
  const byId = new Map<string, SearchOpsOpportunity>();
  for (const op of merged) {
    if (!byId.has(op.id)) byId.set(op.id, op);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
}
