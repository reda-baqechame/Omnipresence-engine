/**
 * Pure helpers for honoring a deep report's selected `sections` preset
 * (reports.sections). Split out from intelligence-report-builder.ts so this
 * logic — which used to be silently ignored (P0 #9: every deep report
 * rendered all 16 sections regardless of what was picked) — can be unit
 * tested without pulling in the full provider/PDF-rendering import chain.
 */
import {
  ALL_INTELLIGENCE_SECTIONS,
  type IntelligenceReport,
  type IntelligenceReportSectionId,
  type SectionMeta,
} from "@/types/intelligence-report";

/** Sections a preset can opt in/out of. "executive" and "methodology" are
 * structural (cover/exec summary, required data-provenance appendix) and are
 * force-included in resolveSectionsIncluded() rather than listed here. */
export const EXCLUDABLE_SECTIONS: IntelligenceReportSectionId[] = [
  "competitive",
  "visibility",
  "keywords",
  "backlinks",
  "technical",
  "local",
  "entity",
  "schema",
  "community",
  "reputation",
  "ppc",
  "roi",
  "roadmap",
  "proof",
];

/** Resolves the requested preset into the final section list: "executive"
 * and "methodology" are always force-included; an empty/omitted selection
 * means "everything". */
export function resolveSectionsIncluded(
  requested?: IntelligenceReportSectionId[]
): IntelligenceReportSectionId[] {
  const base = requested?.length ? requested : [...ALL_INTELLIGENCE_SECTIONS];
  return Array.from(new Set<IntelligenceReportSectionId>([...base, "executive", "methodology"]));
}

/** Forces excluded sections' `available` flag off on an already-assembled
 * report, so rendering (which gates purely on `available`) honors the
 * user's selected preset regardless of whether the underlying data for an
 * excluded section happened to be gathered. Mutates and returns `report`. */
export function applySectionSelection(
  report: IntelligenceReport,
  sectionsIncluded: IntelligenceReportSectionId[]
): IntelligenceReport {
  for (const id of EXCLUDABLE_SECTIONS) {
    if (!sectionsIncluded.includes(id)) {
      const section = report[id] as SectionMeta;
      section.available = false;
      section.note = "Excluded — not part of the selected report sections.";
    }
  }
  return report;
}
