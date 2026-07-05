import type { RoadmapItem, TechnicalFinding, CoverageItem, AuthorityOpportunity } from "@/types/database";

export async function generateRoadmap(
  projectId: string,
  brandName: string,
  domain: string,
  industry: string,
  location: string,
  technicalFindings: TechnicalFinding[],
  coverageGaps: CoverageItem[],
  authorityOpportunities: AuthorityOpportunity[],
  durationDays = 90,
  /** Deterministic-first AEO next actions to front-load in the roadmap. */
  deterministicActions: string[] = []
): Promise<{ project_id: string; duration_days: number; items: RoadmapItem[] }> {
  const criticalFindings = technicalFindings.filter((f) => f.severity === "critical" || f.severity === "high");
  const missingCoverage = coverageGaps.filter((c) => !c.is_present);
  const topOpportunities = authorityOpportunities
    .filter((o) => o.measured || o.data_source === "measured")
    .sort((a, b) => (b.estimated_impact || 0) - (a.estimated_impact || 0))
    .slice(0, 8);

  const deterministicItems: RoadmapItem[] = deterministicActions.slice(0, 4).map((action, i) => {
    const [name, ...rest] = action.split(":");
    return {
      week: 1,
      title: `AEO lever: ${name.trim()}`,
      description: rest.join(":").trim() || action,
      impact: i === 0 ? "critical" : "high",
      category: "aeo_readiness",
      estimated_hours: 2,
      evidence_label: "AEO readiness scan",
      source_type: "aeo_readiness",
    };
  });

  return {
    project_id: projectId,
    duration_days: durationDays,
    items: buildEvidenceLinkedRoadmap(
      brandName,
      domain,
      industry,
      location,
      deterministicItems,
      criticalFindings,
      missingCoverage,
      topOpportunities
    ),
  };
}

function buildEvidenceLinkedRoadmap(
  brandName: string,
  domain: string,
  industry: string,
  location: string,
  deterministicItems: RoadmapItem[],
  criticalFindings: TechnicalFinding[],
  missingCoverage: CoverageItem[],
  topOpportunities: AuthorityOpportunity[]
): RoadmapItem[] {
  const items: RoadmapItem[] = [...deterministicItems];
  let week = 1;

  for (const finding of criticalFindings.slice(0, 6)) {
    items.push({
      week,
      title: `Fix: ${finding.title}`,
      description: `${finding.fix_recommendation || finding.description} Evidence: ${finding.title} was measured on ${domain}.`,
      impact: "critical",
      category: finding.category,
      estimated_hours: 2,
      evidence_label: finding.title,
      evidence_url: finding.evidence_url,
      source_type: "technical_finding",
    });
    week = Math.min(week + 1, 3);
  }

  for (const gap of missingCoverage.slice(0, 5)) {
    items.push({
      week: Math.min(week, 6),
      title: `Verify and build ${gap.platform_name} presence`,
      description: `The latest brand search did not surface a ${gap.platform_name} profile for ${brandName}. Create or improve the profile, then re-scan to verify it appears in brand SERPs.`,
      impact: "medium",
      category: gap.surface,
      estimated_hours: 1,
      evidence_label: `${gap.platform_name} missing in brand SERP`,
      evidence_url: gap.evidence_url || gap.profile_url,
      source_type: "coverage_gap",
    });
    week = Math.min(week + 1, 7);
  }

  for (const opp of topOpportunities.slice(0, 6)) {
    items.push({
      week: Math.min(week, 10),
      title: `Win citation from ${opp.target_site}`,
      description: `${opp.pitch_angle} This opportunity is included because a measured source/backlink/citation gap identified ${opp.target_site}.`,
      impact: (opp.estimated_impact || 0) >= 80 ? "high" : "medium",
      category: "authority",
      estimated_hours: 2,
      evidence_label: `${opp.type}: ${opp.target_site}`,
      evidence_url: opp.evidence_url || opp.target_url,
      source_type: "authority_opportunity",
    });
    week = Math.min(week + 1, 11);
  }

  if (items.length > deterministicItems.length) {
    items.push({
      week: Math.min(week + 1, 12),
      title: "Re-scan and verify completed work",
      description: `Re-run the scan for ${brandName} after the measured fixes are complete. Do not mark the roadmap successful until visibility, coverage, or technical evidence changes.`,
      impact: "high",
      category: "verification",
      estimated_hours: 1,
      evidence_label: "Follow-up scan required",
      source_type: "aeo_readiness",
    });
  }

  return items;
}
