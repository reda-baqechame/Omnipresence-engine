import React from "react";
import { Document, Page, Text, View, StyleSheet, Link } from "@react-pdf/renderer";
import { buildReportViewModel, type ReportData } from "@/lib/engines/report-generator";
import { getScoreLabel } from "@/lib/scoring/omnipresence";

/**
 * Downloadable PDF for the standard report. A hostile audit found this
 * document was a separate, much thinner artifact than generateReportHTML() —
 * missing AI visibility, share-of-voice, ads-replacement, and the
 * methodology appendix entirely, even though those exist in the parallel
 * HTML artifact almost nobody downloads. Every section here is sourced from
 * buildReportViewModel() (report-generator.ts) — the SAME derived metrics
 * and honesty rules the HTML report uses — so the PDF a customer actually
 * downloads matches what the report claims about itself.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a2e" },
  coverPage: { padding: 0, fontFamily: "Helvetica", color: "#1a1a2e" },
  coverBrandBar: { height: 10, backgroundColor: "#6366f1" },
  coverBody: { flex: 1, justifyContent: "center", alignItems: "center", padding: 60 },
  coverBrand: { fontSize: 14, color: "#6366f1", fontWeight: "bold", marginBottom: 40 },
  coverTitle: { fontSize: 30, fontWeight: "bold", textAlign: "center", marginBottom: 12 },
  coverSubtitle: { fontSize: 14, color: "#555", textAlign: "center", marginBottom: 4 },
  coverMeta: { fontSize: 10, color: "#888", textAlign: "center", marginTop: 30 },
  coverScoreHero: {
    marginTop: 50,
    alignItems: "center",
    padding: 24,
    borderRadius: 10,
    backgroundColor: "#f4f4ff",
    width: 220,
  },
  coverScoreNumber: { fontSize: 54, fontWeight: "bold", color: "#6366f1" },
  coverScoreLabel: { fontSize: 11, color: "#666", marginTop: 4, textAlign: "center" },
  header: { marginBottom: 18, borderBottomWidth: 2, borderBottomColor: "#6366f1", paddingBottom: 10 },
  headerTitle: { fontSize: 16, fontWeight: "bold", color: "#6366f1" },
  headerSubtitle: { fontSize: 9, color: "#666", marginTop: 2 },
  section: { marginBottom: 16 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: "bold", color: "#6366f1" },
  tag: { fontSize: 7, fontWeight: "bold", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, marginLeft: 6, textTransform: "uppercase" },
  tagLive: { backgroundColor: "#dcfce7", color: "#166534" },
  tagPartial: { backgroundColor: "#fef9c3", color: "#854d0e" },
  tagUnavailable: { backgroundColor: "#f1f5f9", color: "#64748b" },
  tagEstimated: { backgroundColor: "#e0e7ff", color: "#3730a3" },
  paragraph: { fontSize: 9.5, color: "#333", marginBottom: 6, lineHeight: 1.4 },
  legend: { fontSize: 8, color: "#94a3b8", marginTop: 4, lineHeight: 1.4 },
  scorecardGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  scorecardCell: { width: "25%", padding: 4 },
  scorecardBox: { backgroundColor: "#f8f9fa", borderRadius: 6, padding: 8, alignItems: "center" },
  scorecardValue: { fontSize: 18, fontWeight: "bold", color: "#6366f1" },
  scorecardValueNoData: { fontSize: 14, fontWeight: "bold", color: "#94a3b8" },
  scorecardLabel: { fontSize: 7, color: "#888", textTransform: "uppercase", marginTop: 2, textAlign: "center" },
  metricsRow: { flexDirection: "row", marginVertical: 6 },
  metricCell: { flex: 1, alignItems: "center" },
  metricValue: { fontSize: 18, fontWeight: "bold", color: "#6366f1" },
  metricLabel: { fontSize: 7.5, color: "#888", marginTop: 2 },
  finding: { marginBottom: 6, paddingLeft: 8, borderLeftWidth: 3, borderLeftColor: "#ef4444" },
  findingHigh: { borderLeftColor: "#f97316" },
  findingTitle: { fontSize: 9.5, fontWeight: "bold" },
  findingDesc: { fontSize: 8.5, color: "#666", marginTop: 1 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f1f1", paddingVertical: 4 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e2e2", paddingBottom: 4, marginBottom: 2 },
  tableHeaderCell: { fontSize: 8, fontWeight: "bold", color: "#444" },
  tableCell: { fontSize: 8.5, color: "#333" },
  bulletRow: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 10, fontSize: 9 },
  bulletText: { flex: 1, fontSize: 9, color: "#333" },
  coverageItem: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 4, fontSize: 8, marginBottom: 3, marginRight: 4 },
  coveragePresent: { backgroundColor: "#dcfce7", color: "#166534" },
  coverageMissing: { backgroundColor: "#fee2e2", color: "#991b1b" },
  coverageGrid: { flexDirection: "row", flexWrap: "wrap" },
  roadmapItem: { flexDirection: "row", marginBottom: 6, gap: 8 },
  weekBadge: { backgroundColor: "#6366f1", color: "white", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, fontSize: 7, height: 14 },
  roadmapTitle: { fontSize: 9, fontWeight: "bold" },
  roadmapDesc: { fontSize: 8, color: "#666" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, textAlign: "center", fontSize: 7.5, color: "#999" },
  pageNumber: { position: "absolute", bottom: 24, right: 40, fontSize: 7.5, color: "#999" },
});

function Tag({ tone, children }: { tone: "live" | "partial" | "unavailable" | "estimated"; children: React.ReactNode }) {
  const toneStyle =
    tone === "live" ? styles.tagLive : tone === "partial" ? styles.tagPartial : tone === "estimated" ? styles.tagEstimated : styles.tagUnavailable;
  return (
    <Text style={[styles.tag, toneStyle]} wrap={false}>
      {children}
    </Text>
  );
}

function SectionTitle({ title, tone, tagText }: { title: string; tone?: "live" | "partial" | "unavailable" | "estimated"; tagText?: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {tone && tagText ? <Tag tone={tone}>{tagText}</Tag> : null}
    </View>
  );
}

function PageHeader({ project, brand }: { project: ReportData["project"]; brand: string }) {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.headerTitle}>{brand} — OmniPresence Report</Text>
      <Text style={styles.headerSubtitle}>
        {project.name} — {project.domain}
      </Text>
    </View>
  );
}

function PageFooter({ brand }: { brand: string }) {
  return (
    <>
      <Text style={styles.footer} fixed>
        {brand} — The Organic Visibility Engine. Built to reduce dependence on paid ads by creating compounding organic visibility.
      </Text>
      <Text
        style={styles.pageNumber}
        fixed
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </>
  );
}

function scorecardCell(label: string, value: number, available: boolean) {
  return (
    <View style={styles.scorecardCell} key={label}>
      <View style={styles.scorecardBox}>
        {available ? (
          <Text style={styles.scorecardValue}>{Math.round(value)}</Text>
        ) : (
          <Text style={styles.scorecardValueNoData}>—</Text>
        )}
        <Text style={styles.scorecardLabel}>{label}</Text>
      </View>
    </View>
  );
}

export function OmniPresenceReportPDF({
  data,
  whiteLabel,
}: {
  data: ReportData;
  whiteLabel?: { name: string; color: string };
}) {
  const brand = whiteLabel?.name || "PresenceOS";
  const scoreLabel = getScoreLabel(data.score.omnipresence_score);
  const vm = buildReportViewModel(data);
  const {
    subScoreAvailable,
    visibility,
    sov,
    criticalFindings,
    missingCoverage,
    topOpportunities,
    competitorWinPrompts,
    socialGaps,
    directoryGaps,
    localGaps,
    reviewGaps,
    measuredPct,
    maxSamples,
    aiProvenance,
    methodologyRows,
  } = vm;

  const provenanceTone = aiProvenance === "Live" ? "live" : aiProvenance === "Partial" ? "partial" : "unavailable";
  const hasAiSamples = visibility.sampleSize > 0;
  const topRoadmap = data.roadmapItems.slice(0, 15);
  const prioritizedRecommendations = [...data.roadmapItems]
    .sort((a, b) => {
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (rank[a.impact] ?? 4) - (rank[b.impact] ?? 4);
    })
    .slice(0, 8);
  const measuredDimensionCount = Object.values(subScoreAvailable).filter(Boolean).length;
  const totalDimensionCount = Object.keys(subScoreAvailable).length;
  const unavailableDimensionLabels = Object.entries(subScoreAvailable)
    .filter(([, available]) => !available)
    .map(([label]) => label);

  return (
    <Document>
      {/* 1. Cover page */}
      <Page size="A4" style={styles.coverPage}>
        <View style={styles.coverBrandBar} />
        <View style={styles.coverBody}>
          <Text style={styles.coverBrand}>{brand}</Text>
          <Text style={styles.coverTitle}>OmniPresence Report</Text>
          <Text style={styles.coverSubtitle}>{data.project.name}</Text>
          <Text style={styles.coverSubtitle}>{data.project.domain}</Text>
          <View style={styles.coverScoreHero}>
            <Text style={styles.coverScoreNumber}>{Math.round(data.score.omnipresence_score)}</Text>
            <Text style={styles.coverScoreLabel}>OmniPresence Score — {scoreLabel.label}</Text>
          </View>
          <Text style={styles.coverMeta}>
            Generated {new Date(data.generatedAt).toLocaleDateString()} · {measuredDimensionCount}/{totalDimensionCount} score
            dimensions measured
          </Text>
        </View>
      </Page>

      {/* 2. Executive summary + 3. Current-state scorecard + 4. Data Sources & Measurement Confidence */}
      <Page size="A4" style={styles.page}>
        <PageHeader project={data.project} brand={brand} />

        <View style={styles.section}>
          <SectionTitle title="Executive Summary" />
          <Text style={styles.paragraph}>
            {data.project.name} scores {Math.round(data.score.omnipresence_score)}/100 overall ({scoreLabel.label}),
            based on {measuredDimensionCount} of {totalDimensionCount} measurable presence dimensions this run.
            {unavailableDimensionLabels.length > 0
              ? ` ${unavailableDimensionLabels.join(", ")} could not be measured this run and are excluded from the score rather than counted as zero.`
              : " Every dimension had a live signal this run."}
          </Text>
          <Text style={styles.paragraph}>
            {hasAiSamples
              ? `AI engines mentioned ${data.project.name} in ${Math.round(visibility.mentionRate * 100)}% of measured prompts (${aiProvenance.toLowerCase()} read, ${measuredPct}% of prompts probed live).`
              : "AI visibility could not be measured this run — no AI engine probes returned usable data."}
            {" "}
            {criticalFindings.length > 0
              ? `${criticalFindings.length} critical/high-severity technical issue${criticalFindings.length === 1 ? "" : "s"} require attention.`
              : "No critical/high-severity technical issues were found."}
            {" "}
            {missingCoverage.length > 0
              ? `${missingCoverage.length} presence surfaces are not yet claimed.`
              : "All tracked presence surfaces are claimed."}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="Current-State Scorecard" />
          <View style={styles.scorecardGrid}>
            {scorecardCell("AI Visibility", data.score.ai_visibility, subScoreAvailable["AI Visibility"])}
            {scorecardCell("Search", data.score.search_visibility, subScoreAvailable.Search)}
            {scorecardCell("Local", data.score.local_visibility, subScoreAvailable.Local)}
            {scorecardCell("Social", data.score.social_presence, subScoreAvailable.Social)}
            {scorecardCell("Directories", data.score.directory_coverage, subScoreAvailable.Directories)}
            {scorecardCell("Authority", data.score.authority_mentions, subScoreAvailable.Authority)}
            {scorecardCell("Technical", data.score.technical_readiness, subScoreAvailable.Technical)}
            {scorecardCell("Conversion", data.score.conversion_readiness, subScoreAvailable.Conversion)}
          </View>
          <Text style={styles.legend}>
            A dash (—) means this dimension had no live signal this run — it is excluded from the composite score, never
            scored as a numeric zero.
          </Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="Data Sources & Measurement Confidence" />
          <Text style={styles.paragraph}>
            AI visibility read: {aiProvenance} ({measuredPct}% of prompts measured live
            {maxSamples > 1 ? `, each sampled up to ${maxSamples}\u00d7` : ""}). Data sources: Supabase (project records)
            · OmniPresence Engine (scoring &amp; measurement pipeline){data.adsEquivalent?.cpcSource === "real" ? " · Google Ads Keyword Planner (real CPC)" : ""}.
          </Text>
          <Text style={styles.legend}>Report generated {new Date(data.generatedAt).toLocaleString()}.</Text>
        </View>

        <PageFooter brand={brand} />
      </Page>

      {/* 5. AI Visibility + 6. Search/SERP Visibility */}
      <Page size="A4" style={styles.page}>
        <PageHeader project={data.project} brand={brand} />

        <View style={styles.section}>
          <SectionTitle title="AI Visibility" tone={provenanceTone} tagText={aiProvenance} />
          {hasAiSamples ? (
            <>
              <View style={styles.metricsRow}>
                <View style={styles.metricCell}>
                  <Text style={styles.metricValue}>{Math.round(visibility.mentionRate * 100)}%</Text>
                  <Text style={styles.metricLabel}>Mention Rate</Text>
                </View>
                <View style={styles.metricCell}>
                  <Text style={styles.metricValue}>{Math.round(visibility.citationRate * 100)}%</Text>
                  <Text style={styles.metricLabel}>Citation Rate</Text>
                </View>
                <View style={styles.metricCell}>
                  <Text style={styles.metricValue}>{Math.round(visibility.winRate * 100)}%</Text>
                  <Text style={styles.metricLabel}>Win Rate</Text>
                </View>
              </View>
              <Text style={styles.legend}>
                Recommendation strength: {Math.round((visibility.prominence ?? 0) * 100)}%
                {visibility.avgPosition !== null ? ` · Avg. answer position: #${visibility.avgPosition}` : ""} — how
                strongly (not just whether) AI engines recommend you when you appear.
              </Text>
              <Text style={styles.legend}>
                Mention rate 95% confidence interval: {Math.round(visibility.mentionRateCI.low * 100)}%–
                {Math.round(visibility.mentionRateCI.high * 100)}% across {visibility.sampleSize} measured probe
                {visibility.sampleSize === 1 ? "" : "s"} (Wilson score interval) · overall read confidence{" "}
                {Math.round(visibility.confidence * 100)}%. A narrower band means a more certain measurement.
              </Text>
            </>
          ) : (
            <Text style={styles.paragraph}>
              Unavailable — no AI engine probes returned measured data this run. This is not scored as a 0% mention
              rate; it is omitted from the composite score entirely.
            </Text>
          )}
        </View>

        {sov.sampleSize > 0 && sov.leaderboard.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle
              title="AI Share of Voice"
              tone={sov.brandRank === 1 ? "live" : "estimated"}
              tagText={sov.brandRank !== null ? `Rank #${sov.brandRank} of ${sov.leaderboard.length}` : undefined}
            />
            <Text style={styles.legend}>
              Prominence-weighted across {sov.sampleSize} measured AI answer{sov.sampleSize === 1 ? "" : "s"} — being
              named the #1 pick counts more than a passing mention near the bottom.
            </Text>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, { width: "40%" }]}>Brand</Text>
              <Text style={[styles.tableHeaderCell, { width: "20%" }]}>Share of Voice</Text>
              <Text style={[styles.tableHeaderCell, { width: "20%" }]}>Answers</Text>
              <Text style={[styles.tableHeaderCell, { width: "20%" }]}>Avg. position</Text>
            </View>
            {sov.leaderboard.slice(0, 8).map((row) => (
              <View style={styles.tableRow} key={row.name}>
                <Text style={[styles.tableCell, { width: "40%", fontWeight: row.isBrand ? "bold" : "normal" }]}>
                  {row.name}
                  {row.isBrand ? " (you)" : ""}
                </Text>
                <Text style={[styles.tableCell, { width: "20%" }]}>{Math.round(row.shareOfVoice * 100)}%</Text>
                <Text style={[styles.tableCell, { width: "20%" }]}>{row.appearances}</Text>
                <Text style={[styles.tableCell, { width: "20%" }]}>{row.avgPosition !== null ? `#${row.avgPosition}` : "—"}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {competitorWinPrompts.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle title={`AI Prompts Where Competitors Win (${competitorWinPrompts.length})`} />
            <Text style={styles.paragraph}>
              Buyer-intent prompts where an AI engine recommended a competitor and did not mention you — your
              highest-priority AEO gaps.
            </Text>
            {competitorWinPrompts.slice(0, 6).map((w, i) => (
              <View style={styles.finding} key={i}>
                <Text style={styles.findingTitle}>{w.prompt}</Text>
                <Text style={styles.findingDesc}>
                  {w.engine} — winning: {w.winners.slice(0, 3).join(", ")}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.strikingKeywords && data.strikingKeywords.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle title="Search / SERP Visibility — Fastest-Upside Keywords" tone="live" tagText="Live rank" />
            <Text style={styles.paragraph}>
              Already ranking positions 4-20 (measured rank data) — small optimizations here usually deliver the
              fastest traffic gains.
            </Text>
            {data.strikingKeywords.slice(0, 10).map((k, i) => (
              <View style={styles.tableRow} key={i}>
                <Text style={[styles.tableCell, { flex: 1 }]}>
                  {k.keyword}
                  {k.url ? ` — ${k.url}` : ""}
                </Text>
                <Text style={[styles.tableCell, { width: 40, textAlign: "right" }]}>#{k.position}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <PageFooter brand={brand} />
      </Page>

      {/* 7. Technical SEO Findings + 8. Content / Coverage Findings */}
      <Page size="A4" style={styles.page}>
        <PageHeader project={data.project} brand={brand} />

        <View style={styles.section}>
          <SectionTitle title={`Technical SEO Findings (${criticalFindings.length} critical/high)`} />
          {criticalFindings.length > 0 ? (
            criticalFindings.slice(0, 10).map((f, i) => (
              <View style={[styles.finding, f.severity === "high" ? styles.findingHigh : {}]} key={i}>
                <Text style={styles.findingTitle}>{f.title}</Text>
                <Text style={styles.findingDesc}>{f.description}</Text>
                {f.fix_recommendation ? <Text style={styles.findingDesc}>Fix: {f.fix_recommendation}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.paragraph}>No critical or high-severity technical issues were found this run.</Text>
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle title="Content / Coverage Findings" />
          <View style={styles.coverageGrid}>
            {data.coverageItems.slice(0, 24).map((c, i) => (
              <Text
                key={i}
                style={[styles.coverageItem, c.is_present ? styles.coveragePresent : styles.coverageMissing]}
              >
                {c.is_present ? "\u2713 " : "\u2717 "}
                {c.platform_name}
              </Text>
            ))}
          </View>
          {missingCoverage.length > 0 ? (
            <Text style={styles.legend}>
              {missingCoverage.length} platforms missing. Competitors present on{" "}
              {data.coverageItems.filter((c) => c.competitor_present && !c.is_present).length} of them. Gaps by
              surface — Social: {socialGaps.length} · Directories: {directoryGaps.length} · Local: {localGaps.length} ·
              Reviews: {reviewGaps.length}.
            </Text>
          ) : (
            <Text style={styles.legend}>No coverage gaps found on tracked surfaces this run.</Text>
          )}
        </View>

        <PageFooter brand={brand} />
      </Page>

      {/* 9. Authority/Backlink + 10. Local/Directory + 11. Ads-Replacement */}
      <Page size="A4" style={styles.page}>
        <PageHeader project={data.project} brand={brand} />

        <View style={styles.section}>
          <SectionTitle title="Authority Opportunities" />
          {topOpportunities.length > 0 ? (
            topOpportunities.map((o, i) => (
              <View style={styles.roadmapItem} key={i}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roadmapTitle}>
                    {o.target_site} ({o.type})
                  </Text>
                  <Text style={styles.roadmapDesc}>{o.pitch_angle || "Opportunity identified"}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.paragraph}>No authority/backlink opportunities identified this run.</Text>
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle title="Local / Directory Coverage" />
          {localGaps.length > 0 || directoryGaps.length > 0 ? (
            <Text style={styles.paragraph}>
              {localGaps.length} local listing gap{localGaps.length === 1 ? "" : "s"} and {directoryGaps.length}{" "}
              directory listing gap{directoryGaps.length === 1 ? "" : "s"} identified from measured coverage checks.
            </Text>
          ) : (
            <Text style={styles.paragraph}>No local/directory coverage gaps found this run.</Text>
          )}
        </View>

        {data.adsEquivalent ? (
          <View style={styles.section}>
            <SectionTitle
              title="Ads-Replacement / Organic Value"
              tone={data.adsEquivalent.cpcSource === "real" ? "live" : "estimated"}
              tagText={data.adsEquivalent.cpcSource === "real" ? "Real CPC" : "Estimated CPC"}
            />
            <View style={styles.metricsRow}>
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>${data.adsEquivalent.totalOrganicValue.toLocaleString()}</Text>
                <Text style={styles.metricLabel}>Organic Value</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>{Math.round(data.adsEquivalent.replacementRatio * 100)}%</Text>
                <Text style={styles.metricLabel}>Replacement Ratio</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricValue}>${data.adsEquivalent.statedAdSpend.toLocaleString()}</Text>
                <Text style={styles.metricLabel}>Stated Ad Spend</Text>
              </View>
            </View>
            <Text style={styles.legend}>
              Organic value = measured GA4 organic + AI-referral sessions ×{" "}
              {data.adsEquivalent.cpcSource === "real"
                ? "your real keyword CPC (Google Ads Keyword Planner)."
                : "an industry-average CPC estimate — connect DataForSEO for your exact CPC."}
            </Text>
          </View>
        ) : (
          <View style={styles.section}>
            <SectionTitle title="Ads-Replacement / Organic Value" tone="unavailable" tagText="Unavailable" />
            <Text style={styles.paragraph}>
              No ad-spend/CPC data connected this run — no dollar value is shown rather than fabricating one.
            </Text>
          </View>
        )}

        <PageFooter brand={brand} />
      </Page>

      {/* 12. Prioritized Recommendations + 13. 30/60/90-Day Roadmap */}
      <Page size="A4" style={styles.page}>
        <PageHeader project={data.project} brand={brand} />

        <View style={styles.section}>
          <SectionTitle title="Prioritized Recommendations" />
          {prioritizedRecommendations.length > 0 ? (
            prioritizedRecommendations.map((item, i) => (
              <View style={styles.bulletRow} key={i}>
                <Text style={styles.bullet}>{i + 1}.</Text>
                <Text style={styles.bulletText}>
                  [{item.impact}] {item.title} — {item.description}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.paragraph}>No recommendations generated this run.</Text>
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle title="30/60/90-Day Execution Roadmap" />
          {topRoadmap.length > 0 ? (
            topRoadmap.map((item, i) => (
              <View style={styles.roadmapItem} key={i}>
                <Text style={styles.weekBadge}>W{item.week}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roadmapTitle}>{item.title}</Text>
                  <Text style={styles.roadmapDesc}>{item.description}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.paragraph}>No roadmap items generated this run.</Text>
          )}
        </View>

        <PageFooter brand={brand} />
      </Page>

      {/* 14. Evidence Summary + 15. Methodology & Data Sources + 16. Limitations */}
      <Page size="A4" style={styles.page}>
        <PageHeader project={data.project} brand={brand} />

        <View style={styles.section}>
          <SectionTitle title="Evidence Summary" />
          <Text style={styles.paragraph}>
            This report is built from {visibility.sampleSize} measured AI probe{visibility.sampleSize === 1 ? "" : "s"},{" "}
            {data.technicalFindings.length} technical findings, and {data.coverageItems.length} presence-surface
            checks. {competitorWinPrompts.length > 0 ? `${competitorWinPrompts.length} AI prompts with documented competitor wins are detailed above.` : ""}
          </Text>
        </View>

        <View style={styles.section}>
          <SectionTitle title="Methodology & Data Sources" />
          <Text style={styles.legend}>
            Every figure in this report is labeled by how it was derived. Full data-quality definitions:{" "}
            <Link src="https://github.com/reda-baqechame/Omnipresence-engine/blob/main/docs/DATA_CONTRACT.md">
              Data Contract
            </Link>
            .
          </Text>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, { width: "32%" }]}>Metric</Text>
            <Text style={[styles.tableHeaderCell, { width: "68%" }]}>How it&apos;s derived</Text>
          </View>
          {methodologyRows.map((r, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={[styles.tableCell, { width: "32%", fontWeight: "bold" }]}>{r.metric}</Text>
              <Text style={[styles.tableCell, { width: "68%", color: "#555" }]}>{r.method}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <SectionTitle title="Limitations / Unavailable Data" />
          {unavailableDimensionLabels.length > 0 ? (
            <Text style={styles.paragraph}>
              The following score dimensions had no live signal this run and were excluded from the composite score
              (shown as — rather than 0): {unavailableDimensionLabels.join(", ")}.
            </Text>
          ) : (
            <Text style={styles.paragraph}>Every score dimension had a live signal this run.</Text>
          )}
          {!hasAiSamples ? (
            <Text style={styles.paragraph}>
              AI visibility could not be measured this run — no rate is shown for it, and it is not scored as 0%.
            </Text>
          ) : null}
          {!data.adsEquivalent ? (
            <Text style={styles.paragraph}>
              No ad-spend/CPC data is connected, so no paid-ads-replacement dollar value is shown.
            </Text>
          ) : null}
          <Text style={styles.legend}>
            Roadmap and authority-opportunity priorities are heuristic execution guidance, not a financial guarantee.
          </Text>
        </View>

        <PageFooter brand={brand} />
      </Page>
    </Document>
  );
}
