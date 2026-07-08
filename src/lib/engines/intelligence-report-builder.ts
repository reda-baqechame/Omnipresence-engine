/**
 * Deep Intelligence Report — aggregates every engine the platform runs into one
 * agency-grade payload. Each section degrades gracefully; partial data never
 * blocks report generation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompetitiveSnapshot } from "@/lib/engines/competitive-snapshot";
import { getPopularitySignal } from "@/lib/engines/popularity-signal";
import { getBacklinksFree } from "@/lib/providers/backlinks-free";
import { resolveDomainAuthority } from "@/lib/providers/domain-authority";
import { loadProjectVisibilitySnapshot } from "@/lib/engines/visibility-scope";
import { buildProofReport, renderProofHTML } from "@/lib/engines/proof-report";
import { getLedgerForProject } from "@/lib/engines/results-ledger";
import { getScoreLabel } from "@/lib/scoring/omnipresence";
import { verifyLocalPresence } from "@/lib/engines/local-listings";
import { buildEntityProfile } from "@/lib/engines/entity-engine";
import { getSourceGraph } from "@/lib/engines/source-graph";
import { gatherReportData } from "@/lib/engines/report-builder";
import { getSubScoreAvailability } from "@/lib/scoring/subscore-availability";
import type { RoadmapItem, SubscriptionPlan } from "@/types/database";
import { canUseWhiteLabel } from "@/lib/plans/features";
import {
  type IntelligenceReport,
  type IntelligenceReportBranding,
  type IntelligenceReportSectionId,
  type ReportAttribution,
  type ReportDataQuality,
} from "@/types/intelligence-report";
import { applySectionSelection, resolveSectionsIncluded } from "@/lib/engines/report-section-selection";

const DEFAULT_ATTRIBUTIONS: ReportAttribution[] = [
  { source: "Common Crawl", license: "Open data", url: "https://commoncrawl.org/" },
  { source: "Cloudflare Radar", license: "CC BY-NC 4.0", url: "https://radar.cloudflare.com/" },
  { source: "Tranco", license: "Open ranking list", url: "https://tranco-list.eu/" },
  { source: "OpenStreetMap", license: "ODbL", url: "https://www.openstreetmap.org/copyright" },
];

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function emptySection(quality: ReportDataQuality = "not_available") {
  return { available: false, dataQuality: quality };
}

const DEEP_SUBSCORE_LABEL_KEYS = {
  AI: "ai_visibility",
  Search: "search_visibility",
  Local: "local_visibility",
  Social: "social_presence",
  Directories: "directory_coverage",
  Authority: "authority_mentions",
  Technical: "technical_readiness",
  Conversion: "conversion_readiness",
} as const;

export interface GatherIntelligenceOptions {
  sections?: IntelligenceReportSectionId[];
  organizationId?: string;
}

export async function getOrgReportBranding(
  supabase: SupabaseClient,
  organizationId: string
): Promise<IntelligenceReportBranding | undefined> {
  const { data: org } = await supabase
    .from("organizations")
    .select("white_label_name, white_label_primary_color, logo_url, white_label_domain, plan")
    .eq("id", organizationId)
    .single();

  if (!org?.white_label_name || !canUseWhiteLabel(org.plan as SubscriptionPlan)) {
    return undefined;
  }

  return {
    name: org.white_label_name,
    color: org.white_label_primary_color || "#6366f1",
    logoUrl: org.logo_url || undefined,
    domain: org.white_label_domain || undefined,
  };
}

export async function gatherIntelligenceReport(
  supabase: SupabaseClient,
  projectId: string,
  opts: GatherIntelligenceOptions = {}
): Promise<{ report: IntelligenceReport; branding?: IntelligenceReportBranding } | null> {
  const base = await gatherReportData(supabase, projectId);
  if (!base) return null;

  const { reportData, whiteLabel } = base;
  const project = reportData.project;
  const domain = project.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const competitors = project.competitors || [];
  // Honor the user's selected preset (reports.sections) — previously ignored,
  // so every deep report rendered all 16 sections regardless of what was
  // picked (see applySectionSelection() below, applied after `report` is built).
  const sectionsIncluded = resolveSectionsIncluded(opts.sections);

  const branding =
    (await getOrgReportBranding(supabase, project.organization_id)) ||
    (whiteLabel
      ? { name: whiteLabel.name, color: whiteLabel.color }
      : undefined);

  const attributions: ReportAttribution[] = [...DEFAULT_ATTRIBUTIONS];
  const providersUsed = new Set<string>(["Supabase", "OmniPresence Engine"]);

  const [
    visibilitySnap,
    competitiveTarget,
    competitivePeers,
    popularityDetail,
    backlinks,
    authority,
    keywordOpps,
    rankKws,
    schemaRows,
    communityRows,
    ledger,
    proof,
    sourceGraph,
    localListings,
    entityResult,
    cwvHistory,
  ] = await Promise.all([
    loadProjectVisibilitySnapshot(supabase, projectId, project.name, competitors),
    safe(() => getCompetitiveSnapshot(domain, { name: project.name, includeCwv: true }), null),
    Promise.all(
      competitors.slice(0, 5).map((c) =>
        safe(() => getCompetitiveSnapshot(c, { includeCwv: true }), null)
      )
    ),
    safe(() => getPopularitySignal(domain, { includeCrux: true, includeBacklinks: true }), null),
    safe(() => getBacklinksFree(domain, 25), null),
    safe(() => resolveDomainAuthority(domain), null),
    supabase
      .from("keyword_opportunities")
      .select("keyword, volume_estimate, difficulty, intent, source")
      .eq("project_id", projectId)
      .order("volume_estimate", { ascending: false })
      .limit(30),
    supabase
      .from("rank_keywords")
      .select("keyword, last_position, target_url")
      .eq("project_id", projectId)
      .order("last_position", { ascending: true })
      .limit(50),
    supabase
      .from("schema_deployments")
      .select("schema_types, validation_status, page_url")
      .eq("project_id", projectId)
      .limit(20),
    supabase
      .from("community_mentions")
      .select("platform, keyword, url, mention_type")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(15),
    getLedgerForProject(supabase, projectId, 30),
    safe(() => buildProofReport(supabase, projectId), null),
    safe(() => getSourceGraph(projectId), null),
    project.location
      ? safe(() => verifyLocalPresence({ name: project.name, domain: project.domain, location: project.location }), [])
      : Promise.resolve([]),
    safe(() => buildEntityProfile(project, {}), null),
    supabase
      .from("cwv_history")
      .select("lcp_ms, cls, inp_ms, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (backlinks?.success) providersUsed.add("Common Crawl Webgraph");
    if (popularityDetail?.available) {
    for (const a of popularityDetail.attributions || []) {
      attributions.push({ source: a.source, license: a.license });
      providersUsed.add(a.source);
    }
  }

  const proofHtml = proof ? renderProofHTML(proof, branding?.color || whiteLabel?.color) : undefined;

  const scoreDelta =
    reportData.previousScore
      ? reportData.score.omnipresence_score - reportData.previousScore.omnipresence_score
      : undefined;

  const topWinPrompts = visibilitySnap.scopedResults
    .filter((r) => {
      const comps = r.competitor_mentions || {};
      const competitorWon = Object.values(comps).some(Boolean) && !r.brand_mentioned;
      return competitorWon && r.prompt_text;
    })
    .slice(0, 15)
    .map((r) => ({
      prompt: r.prompt_text,
      engine: r.engine,
      winner:
        Object.entries(r.competitor_mentions || {}).find(([, v]) => v)?.[0] || "competitor",
    }));

  const kwRows = (keywordOpps.data || []).map((k) => ({
    keyword: k.keyword as string,
    volume: k.volume_estimate as number | undefined,
    difficulty: k.difficulty as number | undefined,
    intent: k.intent as string | undefined,
    dataQuality: (k.source === "measured" || k.source === "omnidata_serp"
      ? "measured"
      : "estimated_proxy") as ReportDataQuality,
  }));

  const striking = (reportData.strikingKeywords || []).map((k) => ({
    keyword: k.keyword,
    position: k.position,
    url: k.url,
    dataQuality: "measured" as ReportDataQuality,
  }));

  const backlinkRows =
    backlinks?.success && backlinks.data
      ? backlinks.data.slice(0, 15).map((b) => ({
          domain: b.domain,
          url: b.url,
          dataQuality: "measured" as ReportDataQuality,
        }))
      : [];

  const referringDomains =
    backlinks?.success && backlinks.data
      ? new Set(backlinks.data.map((b) => b.domain)).size
      : competitiveTarget?.components.referringDomains ?? 0;

  const latestCwv = cwvHistory.data;
  const cwvSection = latestCwv
    ? {
        lcp: latestCwv.lcp_ms as number | undefined,
        cls: latestCwv.cls as number | undefined,
        inp: latestCwv.inp_ms as number | undefined,
        dataQuality: "measured" as ReportDataQuality,
      }
    : competitiveTarget?.cwv
      ? {
          lcp: competitiveTarget.cwv.lcpMs,
          cls: competitiveTarget.cwv.cls,
          inp: competitiveTarget.cwv.inpMs,
          dataQuality: "measured" as ReportDataQuality,
        }
      : undefined;

  const criticalFindings = reportData.technicalFindings.filter((f) => f.severity === "critical");
  const highFindings = reportData.technicalFindings.filter((f) => f.severity === "high");

  const report: IntelligenceReport = {
    meta: {
      reportType: "deep",
      project,
      generatedAt: new Date().toISOString(),
      sectionsIncluded,
      brandName: project.name,
      domain,
    },
    executive: {
      available: true,
      dataQuality: "measured",
      omnipresenceScore: reportData.score.omnipresence_score,
      scoreLabel: getScoreLabel(reportData.score.omnipresence_score).label,
      subScores: {
        AI: reportData.score.ai_visibility,
        Search: reportData.score.search_visibility,
        Local: reportData.score.local_visibility,
        Social: reportData.score.social_presence,
        Directories: reportData.score.directory_coverage,
        Authority: reportData.score.authority_mentions,
        Technical: reportData.score.technical_readiness,
        Conversion: reportData.score.conversion_readiness,
      },
      subScoresAvailable: getSubScoreAvailability(reportData.score, DEEP_SUBSCORE_LABEL_KEYS),
      keyFindings: buildKeyFindings(reportData, visibilitySnap, competitiveTarget),
      scoreDelta,
    },
    competitive: {
      available: Boolean(competitiveTarget),
      dataQuality: competitiveTarget ? "estimated_proxy" : "not_available",
      target: competitiveTarget || undefined,
      competitors: competitivePeers.filter(Boolean) as NonNullable<typeof competitiveTarget>[],
      popularityDetail: popularityDetail || undefined,
      attributions: popularityDetail?.attributions?.map((a) => ({
        source: a.source,
        license: a.license,
      })),
    },
    visibility: {
      available: visibilitySnap.attempted > 0,
      dataQuality: visibilitySnap.groundedCount > 0 ? "measured" : "not_available",
      snapshot: visibilitySnap,
      topWinPrompts,
      competitorWinCount: topWinPrompts.length,
      note: visibilitySnap.reliabilityNote || undefined,
    },
    keywords: {
      available: kwRows.length > 0 || striking.length > 0,
      dataQuality: kwRows.some((k) => k.dataQuality === "measured") ? "measured" : "estimated_proxy",
      opportunities: kwRows,
      strikingDistance: striking,
      totalTracked: (rankKws.data || []).length,
    },
    backlinks: {
      available: backlinkRows.length > 0 || referringDomains > 0,
      dataQuality: backlinkRows.length > 0 ? "measured" : "not_available",
      referringDomains,
      topReferrers: backlinkRows,
      authorityRating: authority?.score ?? competitiveTarget?.authority.rating,
      authoritySources: authority?.source ? [authority.source] : competitiveTarget?.authority.sources || [],
    },
    technical: {
      available: reportData.technicalFindings.length > 0 || Boolean(cwvSection),
      dataQuality: reportData.technicalFindings.length > 0 ? "measured" : "not_available",
      findings: [...criticalFindings, ...highFindings].slice(0, 20),
      criticalCount: criticalFindings.length,
      highCount: highFindings.length,
      cwv: cwvSection,
    },
    local: {
      available: localListings.length > 0,
      dataQuality: localListings.some((l) => l.status === "verified") ? "measured" : "estimated_proxy",
      listingsFound: localListings.filter((l) => l.status === "verified").length,
      napConsistent: undefined,
      gaps: localListings.filter((l) => l.status !== "verified").map((l) => l.detail),
    },
    entity: {
      available: Boolean(entityResult),
      dataQuality: entityResult?.profile.knowledge_panel_ready ? "measured" : "estimated_proxy",
      knowledgeGraph: entityResult?.profile.knowledge_panel_ready,
      sameAsCount: Object.keys(entityResult?.profile.same_as_map || {}).length,
      gaps: entityResult?.napIssues?.map((g) => `${g.platform}: ${g.issue}`) || [],
    },
    schema: {
      available: (schemaRows.data || []).length > 0,
      dataQuality: (schemaRows.data || []).length > 0 ? "measured" : "not_available",
      deployments: (schemaRows.data || []).length,
      types: [
        ...new Set(
          (schemaRows.data || []).flatMap((s) =>
            Array.isArray(s.schema_types) ? (s.schema_types as string[]) : []
          )
        ),
      ],
      issues: [],
    },
    community: {
      available: (communityRows.data || []).length > 0,
      dataQuality: (communityRows.data || []).length > 0 ? "measured" : "not_available",
      mentions: (communityRows.data || []).map((m) => ({
        platform: m.platform as string,
        title: (m.keyword as string) || (m.url as string),
        url: m.url as string | undefined,
        sentiment: m.mention_type as string | undefined,
      })),
      totalMentions: (communityRows.data || []).length,
    },
    reputation: {
      available: false,
      dataQuality: "not_available",
      newsMentions: 0,
      highlights: [],
      note: "Run reputation monitoring to populate earned-media signals.",
    },
    ppc: {
      available: false,
      dataQuality: "not_available",
      competitorAdCount: 0,
      highlights: [],
      note: "Connect PPC intelligence for competitor ad copy analysis.",
    },
    roi: {
      available: Boolean(reportData.adsEquivalent),
      dataQuality: reportData.adsEquivalent ? "measured" : "not_available",
      organicSessions: undefined,
      aiReferralSessions: undefined,
      adsEquivalent: reportData.adsEquivalent?.totalOrganicValue,
      replacementRatio: reportData.adsEquivalent?.replacementRatio,
      cpcSource: reportData.adsEquivalent?.cpcSource,
    },
    roadmap: {
      available: reportData.roadmapItems.length > 0,
      dataQuality: "measured",
      items: reportData.roadmapItems.slice(0, 20) as RoadmapItem[],
    },
    proof: {
      available: Boolean(proof || ledger.length),
      dataQuality: proof ? "measured" : "not_available",
      proofHtml,
      ledgerActions: ledger.length,
      guaranteeTier: undefined,
      deliverablesMet: ledger.filter((e) => e.status === "completed" || e.status === "verified").length,
      deliverablesTotal: ledger.length,
    },
    methodology: {
      available: true,
      dataQuality: "measured",
      providersUsed: [...providersUsed],
      attributions: dedupeAttributions(attributions),
      disclaimers: [
        "Popularity and traffic indices are relative proxies — not visit counts.",
        "AI visibility rates require grounded SERP measurements; model-knowledge probes are labeled separately.",
        "Keyword volumes may be estimated from open signals when paid planner data is unavailable.",
      ],
    },
    coverageItems: reportData.coverageItems,
    authorityOpportunities: reportData.authorityOpportunities,
    score: reportData.score,
    previousScore: reportData.previousScore,
    visibilityResults: reportData.visibilityResults,
  };

  if (sourceGraph?.nodes?.length) {
    providersUsed.add("Citation Source Graph");
  }

  applySectionSelection(report, sectionsIncluded);

  return { report, branding };
}

function dedupeAttributions(items: ReportAttribution[]): ReportAttribution[] {
  const seen = new Set<string>();
  return items.filter((a) => {
    const key = a.source;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildKeyFindings(
  reportData: {
    score: { omnipresence_score: number };
    technicalFindings: Array<{ severity: string }>;
    coverageItems: Array<{ is_present: boolean }>;
    strikingKeywords?: Array<{ keyword: string }>;
  },
  visibility: Awaited<ReturnType<typeof loadProjectVisibilitySnapshot>>,
  competitive: Awaited<ReturnType<typeof getCompetitiveSnapshot>> | null
): string[] {
  const findings: string[] = [];
  findings.push(
    `OmniPresence score: ${reportData.score.omnipresence_score}/100 (${getScoreLabel(reportData.score.omnipresence_score).label})`
  );
  if (visibility.ratesReliable) {
    findings.push(
      `AI mention rate: ${Math.round(visibility.metrics.mentionRate * 100)}% across ${visibility.groundedCount} grounded probes`
    );
  }
  if (competitive?.popularity.available) {
    findings.push(
      `Popularity tier ${competitive.popularity.tier}/10 (estimated proxy — not visit counts)`
    );
  }
  const critical = reportData.technicalFindings.filter((f) => f.severity === "critical").length;
  if (critical > 0) findings.push(`${critical} critical technical issues require immediate attention`);
  const missingCoverage = reportData.coverageItems.filter((c) => !c.is_present).length;
  if (missingCoverage > 0) findings.push(`${missingCoverage} platform coverage gaps identified`);
  if (reportData.strikingKeywords?.length) {
    findings.push(`${reportData.strikingKeywords.length} keywords in striking distance (positions 4–20)`);
  }
  return findings.slice(0, 8);
}
