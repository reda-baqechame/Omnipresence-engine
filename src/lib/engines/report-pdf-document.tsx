import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { ReportData } from "@/lib/engines/report-generator";
import { getScoreLabel } from "@/lib/scoring/omnipresence";
import { getSubScoreAvailability } from "@/lib/scoring/subscore-availability";

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1a1a2e" },
  header: { marginBottom: 24, borderBottomWidth: 2, borderBottomColor: "#6366f1", paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: "bold", color: "#6366f1" },
  subtitle: { fontSize: 11, color: "#666", marginTop: 4 },
  scoreHero: { textAlign: "center", marginVertical: 20, padding: 20, backgroundColor: "#f4f4ff", borderRadius: 8 },
  scoreNumber: { fontSize: 48, fontWeight: "bold", color: "#6366f1" },
  scoreLabel: { fontSize: 12, color: "#666", marginTop: 4 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: "bold", color: "#6366f1", marginBottom: 8, borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  finding: { marginBottom: 6, paddingLeft: 8, borderLeftWidth: 3, borderLeftColor: "#ef4444" },
  findingTitle: { fontSize: 10, fontWeight: "bold" },
  findingDesc: { fontSize: 9, color: "#666" },
  roadmapItem: { flexDirection: "row", marginBottom: 6, gap: 8 },
  weekBadge: { backgroundColor: "#6366f1", color: "white", padding: "2 6", borderRadius: 4, fontSize: 8 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, textAlign: "center", fontSize: 8, color: "#999" },
});

export function OmniPresenceReportPDF({
  data,
  whiteLabel,
}: {
  data: ReportData;
  whiteLabel?: { name: string; color: string };
}) {
  const brand = whiteLabel?.name || "PresenceOS";
  const criticalFindings = data.technicalFindings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  ).slice(0, 8);
  const missingCoverage = data.coverageItems.filter((c) => !c.is_present).slice(0, 12);
  const topRoadmap = data.roadmapItems.slice(0, 10);
  const subScoreAvailable = getSubScoreAvailability(data.score, {
    "AI Visibility": "ai_visibility",
    "Search Visibility": "search_visibility",
    "Technical Readiness": "technical_readiness",
    "Directory Coverage": "directory_coverage",
    "Authority Mentions": "authority_mentions",
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>OmniPresence Report</Text>
          <Text style={styles.subtitle}>
            {data.project.name} — {data.project.domain}
          </Text>
          <Text style={styles.subtitle}>Prepared by {brand}</Text>
        </View>

        <View style={styles.scoreHero}>
          <Text style={styles.scoreNumber}>{Math.round(data.score.omnipresence_score)}</Text>
          <Text style={styles.scoreLabel}>
            OmniPresence Score — {getScoreLabel(data.score.omnipresence_score).label}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sub-Scores</Text>
          {[
            ["AI Visibility", data.score.ai_visibility],
            ["Search Visibility", data.score.search_visibility],
            ["Technical Readiness", data.score.technical_readiness],
            ["Directory Coverage", data.score.directory_coverage],
            ["Authority Mentions", data.score.authority_mentions],
          ].map(([label, value]) => (
            <View key={label as string} style={styles.row}>
              <Text>{label}</Text>
              <Text>{subScoreAvailable[label as string] ? `${Math.round(value as number)}/100` : "No data"}</Text>
            </View>
          ))}
        </View>

        {criticalFindings.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Critical Technical Issues</Text>
            {criticalFindings.map((f, i) => (
              <View key={i} style={styles.finding}>
                <Text style={styles.findingTitle}>{f.title}</Text>
                <Text style={styles.findingDesc}>{f.description}</Text>
              </View>
            ))}
          </View>
        )}

        {missingCoverage.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Missing Platform Coverage</Text>
            {missingCoverage.map((c, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                • {c.platform_name}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.footer}>
          Generated {new Date(data.generatedAt).toLocaleDateString()} — {brand} OmniPresence Engine
        </Text>
      </Page>

      {topRoadmap.length > 0 && (
        <Page size="A4" style={styles.page}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>90-Day Execution Roadmap</Text>
            {topRoadmap.map((item, i) => (
              <View key={i} style={styles.roadmapItem}>
                <Text style={styles.weekBadge}>W{item.week}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "bold" }}>{item.title}</Text>
                  <Text style={{ fontSize: 9, color: "#666" }}>{item.description}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.footer}>
            {brand} — Increase discoverability across Google, AI, social, and directories
          </Text>
        </Page>
      )}
    </Document>
  );
}
