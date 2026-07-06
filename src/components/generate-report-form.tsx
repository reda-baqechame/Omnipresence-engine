"use client";

import { useState } from "react";
import { ALL_INTELLIGENCE_SECTIONS, type IntelligenceReportSectionId } from "@/types/intelligence-report";
import { REPORT_PRESETS } from "@/lib/engines/report-presets";

interface GenerateReportFormProps {
  projectId: string;
  canDeepReport: boolean;
}

export function GenerateReportForm({ projectId, canDeepReport }: GenerateReportFormProps) {
  const [presetId, setPresetId] = useState<string>("executive_audit");
  const [reportType, setReportType] = useState<"standard" | "deep">("deep");
  const [sections, setSections] = useState<IntelligenceReportSectionId[]>([...ALL_INTELLIGENCE_SECTIONS]);
  const [customSections, setCustomSections] = useState(false);
  const [loading, setLoading] = useState(false);

  function applyPreset(id: string) {
    setPresetId(id);
    const preset = REPORT_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setReportType(preset.reportType);
    if (preset.sections.length) {
      setSections(preset.sections);
      setCustomSections(false);
    }
  }

  function toggleSection(id: IntelligenceReportSectionId) {
    setCustomSections(true);
    setSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_type: reportType,
          preset: presetId,
          sections: reportType === "deep" ? sections : undefined,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) window.location.href = data.url;
      else if (!res.ok) alert(data.error || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
      <h3 className="text-lg font-semibold">Generate Report</h3>

      <div>
        <label className="text-sm font-medium block mb-2">Report preset</label>
        <select
          value={presetId}
          onChange={(e) => applyPreset(e.target.value)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
        >
          {REPORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.reportType === "deep" && !canDeepReport}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          {REPORT_PRESETS.find((p) => p.id === presetId)?.description}
        </p>
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="reportType"
            checked={reportType === "standard"}
            onChange={() => {
              setReportType("standard");
              setPresetId("standard_summary");
            }}
          />
          <span>
            <strong>Standard</strong>
            <span className="block text-xs text-muted-foreground">Quick summary · sync generation</span>
          </span>
        </label>
        <label className={`flex items-center gap-2 ${canDeepReport ? "cursor-pointer" : "opacity-50"}`}>
          <input
            type="radio"
            name="reportType"
            checked={reportType === "deep"}
            disabled={!canDeepReport}
            onChange={() => setReportType("deep")}
          />
          <span>
            <strong>Deep Intelligence</strong>
            <span className="block text-xs text-muted-foreground">
              Full agency-grade report · all engines · PDF
            </span>
          </span>
        </label>
      </div>

      {reportType === "deep" && (
        <div>
          <button
            type="button"
            className="text-xs text-primary hover:underline mb-2"
            onClick={() => setCustomSections((v) => !v)}
          >
            {customSections ? "Hide section picker" : "Customize sections"}
          </button>
          {customSections && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              {ALL_INTELLIGENCE_SECTIONS.map((id) => (
                <label key={id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sections.includes(id)}
                    onChange={() => toggleSection(id)}
                  />
                  {id.replace(/_/g, " ")}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Generating…" : reportType === "deep" ? "Generate Deep Report" : "Generate Standard Report"}
      </button>
    </form>
  );
}
